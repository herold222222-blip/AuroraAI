const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function handler(event: { httpMethod: string }) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      hasKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      hasQwenKey: Boolean(
        process.env.DASHSCOPE_API_KEY ||
          process.env.QWEN_API_KEY ||
          process.env.QWEN_IMAGE_API_KEY,
      ),
    }),
  };
}
