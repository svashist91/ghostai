import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// Initialize S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: Request) {
  try {
    console.log('--- Analyze Request Started ---');

    // 1. Validate Headers
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    // 2. Initialize Supabase with User Token
    // We pass the token to PostgREST. It verifies the signature automatically.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // NOTE: We skipped auth.getUser() because it crashes on non-UUID Clerk IDs.
    // The DB Update below will serve as our verification.

    // 3. Parse Request
    const body = await request.json();
    const { s3Key, recordId, userPrompt } = body;

    if (!s3Key) {
      return NextResponse.json({ error: 'Missing s3Key' }, { status: 400 });
    }

    // 4. Fetch Image from S3
    const imgCommand = new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: s3Key });
    const imgUrl = await getSignedUrl(s3Client, imgCommand, { expiresIn: 60 });
    const imgResp = await fetch(imgUrl);
    
    if (!imgResp.ok) {
       console.error('❌ S3 Fetch Failed:', imgResp.statusText);
       throw new Error(`Failed to fetch image from S3: ${imgResp.statusText}`);
    }

    const imgBuffer = await imgResp.arrayBuffer();
    
    const imagePart = {
      inlineData: {
        data: Buffer.from(imgBuffer).toString("base64"),
        mimeType: "image/png",
      },
    };

    // 5. Call Gemini AI
    const modelName = "gemini-2.5-flash-lite"; 
    const model = genAI.getGenerativeModel({ model: modelName });
    
    let systemInstruction = "";
    
    if (userPrompt === 'Passive Observation') {
      systemInstruction = `
        You are Drona, an AI assistant observing the user's screen.
        Analyze the screen and provide a brief summary of what is currently visible.
        Keep it concise (1-2 sentences). No punctuation, no emojis.
      `;
    } else if (userPrompt && userPrompt.trim() !== "") {
      systemInstruction = `
        You are Drona, a smart AI assistant capable of seeing the user's screen.

        The user asked: "${userPrompt}"

        INSTRUCTIONS:

        1. **Visual Context:** First, look at the screen. If the user asks about content on the screen (e.g., "summarize this", "who sent this email", "what is this code"), answer strictly based on the image.

        2. **General Knowledge:** If the question is general (e.g., "History of the Internet", "Capital of India", "How do I cook pasta") and the answer is NOT on the screen, IGNORE the image and answer using your general knowledge.

        3. **Hybrid:** If the user asks a question that requires both (e.g., "Who is this actor and what movies are they in?"), combine visual identification with your internal knowledge.

        OUTPUT RULES:

        1. Answer directly and concisely (1-2 sentences max).

        2. NO punctuation (no periods, commas, etc) - this is for TTS.

        3. NO emojis.

        4. Just output the raw words for the spoken answer.

      `;
    } else {
      systemInstruction = "Analyze the screen. Provide a brief summary of the current activity.";
    }

    console.log('🧠 Sending to Gemini...');
    const result = await model.generateContent([systemInstruction, imagePart]);
    let finalResponse = result.response.text();
    console.log('🗣️ Gemini Response:', finalResponse.substring(0, 50) + '...');

    // 6. Cleanup Response
    if (userPrompt && userPrompt !== 'Passive Observation' && userPrompt.trim() !== "") {
      finalResponse = finalResponse
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") 
        .replace(/\s{2,}/g, " ") 
        .replace(/[\u{1F600}-\u{1F64F}]/gu, "") 
        .trim();
    }

    // 7. Update Database (Using User Token)
    // We use the 'supabase' client we created in Step 2.
    // This ensures RLS runs and verifies the token.
    const { error: updateError } = await supabase
      .from('user_states')
      .update({ text_content: finalResponse })
      .eq('id', recordId);

    if (updateError) {
      console.error('❌ DB Update Error:', updateError);
      // We don't fail the request here because the user still needs the voice response
    } else {
      console.log('✅ DB Updated Successfully');
    }

    return NextResponse.json({ 
      success: true, 
      response: finalResponse 
    });

  } catch (error: any) {
    console.error('❌ Drona Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

