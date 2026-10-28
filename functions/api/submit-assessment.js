// Cloudflare Pages Function
// Lives at /functions/api/submit-assessment.js in the project root
// (next to index.html and qualify.html) — Cloudflare auto-detects it
// and serves it at: yoursite.com/api/submit-assessment
//
// What it needs to work (set in Cloudflare Pages → Settings → Environment variables):
//   NOTION_TOKEN        — the "Internal Integration Secret" from your Notion integration
//   NOTION_DATABASE_ID  — the ID of the "Assessment Leads — The Borah Way" database
//                         (currently: 8d63bb71-b781-498d-8094-1b153ca6876b)

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch (err) {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  // Honeypot — bots fill every field including hidden ones, real visitors never see this one.
  // Pretend success so bots don't learn to look for a different signal.
  if (data.company) {
    return json({ ok: true });
  }

  // Section 1 — who they are
  const name = str(data.name);
  const email = str(data.email);
  const countryCode = str(data.country_code);   // e.g. "+91"
  const country = str(data.country);             // e.g. "India"
  const phoneRaw = str(data.phone);
  // Combine into "+91 9876543210" so the phone column shows a full dialable number
  const phone = countryCode && phoneRaw ? `${countryCode} ${phoneRaw}` : phoneRaw;
  const business = str(data.business);

  // Section 2 — where they are (ACE diagnostic)
  const whyYou = str(data.whyyou);
  const clientsNotice = str(data.clients_notice);
  const firstContact = str(data.first_contact);

  // Section 3 — where they want to go
  const currentSituation = str(data.current_situation);
  const win = Array.isArray(data.win) ? data.win.slice(0, 2).map(str).filter(Boolean) : [];
  const urgency = str(data.urgency);
  const budget = str(data.budget);

  // All required
  if (!name || !email || !countryCode || !country || !phoneRaw || !business || !whyYou ||
      !clientsNotice || !firstContact || !currentSituation ||
      win.length === 0 || !urgency || !budget) {
    return json({ ok: false, error: "Please answer every question." }, 400);
  }

  // "Not yet decided" is a silent drop — we return success so the visitor
  // gets the thank-you page, but we don't clutter the CRM with tire-kickers.
  if (budget === "Not yet decided") {
    return json({ ok: true });
  }

  if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID) {
    return json({ ok: false, error: "Server isn't configured yet. Try again shortly." }, 500);
  }

  // Status routing based on budget:
  //   $3k+ or $1k–$3k   → Priority (call ASAP)
  //   Under $1k         → Nurture (follow up in 2–3 days)
  let status;
  if (budget === "$3k+" || budget === "$1k to $3k") {
    status = "Priority - Call ASAP";
  } else {
    status = "Nurture - Follow up in 2-3 days";
  }

  const notionBody = {
    parent: { database_id: env.NOTION_DATABASE_ID },
    properties: {
      "Name": { title: [{ text: { content: name } }] },
      "Email": { email: email },
      "Country": { rich_text: [{ text: { content: country } }] },
      "Phone": { phone_number: phone },
      "Business / Website": { rich_text: [{ text: { content: business } }] },
      "Why You": { rich_text: [{ text: { content: whyYou } }] },
      "Clients Notice": { select: { name: clientsNotice } },
      "First Contact": { select: { name: firstContact } },
      "Current Situation": { select: { name: currentSituation } },
      "90-Day Win": { multi_select: win.map((w) => ({ name: w })) },
      "Urgency": { select: { name: urgency } },
      "Budget Range": { select: { name: budget } },
      "Status": { status: { name: status } },
    },
  };

  let notionRes;
  try {
    notionRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(notionBody),
    });
  } catch (err) {
    return json({ ok: false, error: "Could not reach the database. Please try again." }, 502);
  }

  if (!notionRes.ok) {
    // Log for your own debugging, don't leak Notion's raw error to the visitor
    const errText = await notionRes.text().catch(() => "");
    console.error("Notion API error:", notionRes.status, errText);
    return json({ ok: false, error: "Could not save your submission. Please try again." }, 502);
  }

  return json({ ok: true });
}

function str(v) {
  return (typeof v === "string" ? v : "").trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
