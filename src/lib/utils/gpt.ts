import { OPENAI_API_KEY } from '$env/static/private';

export async function askGpt(messages: any[], items: any[]) {
  const systemPrompt = {
    role: 'system',
    content: `Du bist ein freundlicher Modeassistent. Antworte kumpelhaft, kurz, hilfreich. Du kennst folgende Kleidungsstücke des Nutzers:\n\n${JSON.stringify(items, null, 2)}`
  };

  const fullMessages = [systemPrompt, ...messages];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: fullMessages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Error: ${err}`);
  }

  return await res.json();
}