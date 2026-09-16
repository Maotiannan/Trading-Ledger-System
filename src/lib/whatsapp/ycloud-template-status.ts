export async function isYCloudTemplateApproved(input: { apiKey: string; wabaId: string; name: string; language: string }) {
  if (!input.wabaId) return false;
  const query = new URLSearchParams({ 'filter.wabaId': input.wabaId, 'filter.name': input.name, 'filter.language': input.language, limit: '100' });
  const response = await fetch('https://api.ycloud.com/v2/whatsapp/templates?' + query, {
    headers: { 'X-API-Key': input.apiKey }, redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  if (!response.ok) return false;
  const data = await response.json();
  return Array.isArray(data.items) && data.items.some((item: { name: string; language: string; status: string; category: string }) =>
    item.name === input.name && item.language === input.language && item.status === 'APPROVED' && item.category === 'UTILITY');
}
