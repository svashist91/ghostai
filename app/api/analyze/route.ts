import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { s3Key, recordId, userPrompt } = await request.json();

    if (!s3Key) {
      return NextResponse.json({ error: 'Missing s3Key' }, { status: 400 });
    }

    // --- FETCH IMAGE FROM S3 ---
    const imgCommand = new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key });
    const imgUrl = await getSignedUrl(s3Client, imgCommand, { expiresIn: 60 });
    const imgResp = await fetch(imgUrl);
    const imgBuffer = await imgResp.arrayBuffer();
    
    const imagePart = {
      inlineData: {
        data: Buffer.from(imgBuffer).toString("base64"),
        mimeType: "image/png",
      },
    };

    // --- MODEL: gemini-1.5-flash (Text + Image) ---
    const modelName = "gemini-1.5-flash"; 
    const model = genAI.getGenerativeModel({ model: modelName });
    
    let systemInstruction = "";
    let parts: any[] = [imagePart];

    // Determine prompt based on user input
    if (userPrompt === 'Passive Observation') {
      // Passive mode: Just summarize the screen
      systemInstruction = `
        You are Drona, an AI assistant observing the user's screen.
        Analyze the screen and provide a brief summary of what is currently visible.
        Keep it concise (1-2 sentences). No punctuation, no emojis.
      `;
    } else if (userPrompt && userPrompt.trim() !== "") {
      // Active mode: Answer the user's question
      systemInstruction = `
        You are Drona, an AI assistant.
        The user asked: "${userPrompt}"
        Look at the screen and answer the question directly based on what you see.
        RULES:
        1. Answer directly and immediately.
        2. DO NOT provide analysis, summary, or context.
        3. DO NOT use any punctuation (no periods, commas, question marks).
        4. DO NOT use emojis.
        5. Just output the raw words for the answer.
      `;
    } else {
      // Fallback: Brief summary
      systemInstruction = "Analyze the screen. Provide a brief summary of the current activity.";
    }

    // Add the text prompt as a text part
    parts.push(systemInstruction);

    // --- EXECUTE ---
    const result = await model.generateContent(parts);
    let finalResponse = result.response.text();

    // --- CLEANUP: Remove punctuation and emojis for active queries ---
    if (userPrompt && userPrompt !== 'Passive Observation' && userPrompt.trim() !== "") {
      finalResponse = finalResponse
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") 
        .replace(/\s{2,}/g, " ") 
        .replace(/[\u{1F600}-\u{1F64F}]/gu, "") 
        .trim();
    }

    // --- UPDATE DATABASE ---
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabaseAdmin
      .from('user_states')
      .update({ text_content: finalResponse })
      .eq('id', recordId);

    // --- RETURN RESPONSE ---
    return NextResponse.json({ 
      success: true, 
      response: finalResponse 
    });

  } catch (error: any) {
    console.error('Drona Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
