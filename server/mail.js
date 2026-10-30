// Mail goes out through Resend's HTTP API. Without RESEND_API_KEY the message is
// printed to the server log instead, which is all local development needs.

export async function sendMail({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n--- mail to ${to}: ${subject}\n${text}\n---\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'BotBench <onboarding@resend.dev>', to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${await res.text()}`);
}
