import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    // 1. Setup Google Client
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ response: "Server Error: Missing GOOGLE_API_KEY." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // 2. INTELLIGENCE INJECTION (The "Brain")
    // This gives the model a watch and an identity.
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dateString = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const systemPrompt = `
    IDENTITY:
    You are a highly intelligent, helpful, and conversational AI assistant. 
    You are not a generic language model; you are a capable partner to the user.

    REAL-TIME CONTEXT:
    - Current Date: ${dateString}
    - Current Time: ${timeString}
    - Location: User is likely in Burnaby, BC (based on settings).

    INSTRUCTIONS:
    1. ANSWER DIRECTLY: Be concise. Avoid fluff like "As an AI...".
    2. USE CONTEXT: If asked about time or date, use the values above.
    3. VISION: If an image is provided, analyze it immediately.
    4. PERSONALITY: Be warm, professional, and slightly witty if appropriate.
    `;

    // 3. Initialize Model with the "Brain"
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // Using your preferred 2.5 model
      systemInstruction: systemPrompt,
    });

    // 4. Parse Data
    // We look for 'history' (full chat) first, fallback to 'text' (single message)
    const body = await req.json();
    const { image, text, history } = body; 

    console.log("🟢 Request:", text || "Processing history...");

    // 5. Construct the Chat
    let chat;
    
    // Convert frontend message format to Gemini format if history exists
    if (history && Array.isArray(history) && history.length > 0) {
      const formattedHistory = history.map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model', // Gemini uses 'model', not 'ai'
        parts: [{ text: msg.content }],
      }));
      
      chat = model.startChat({
        history: formattedHistory,
      });
    } else {
      // Fallback: Start a fresh chat if no history provided
      chat = model.startChat({ history: [] });
    }

    // 6. Handle Image (if present)
    const parts: any[] = [{ text: text }];

    if (image) {
      const base64Data = image.split(',')[1];
      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg",
        },
      });
    }

    // 7. Generate Response
    const result = await chat.sendMessage(parts);
    const response = await result.response;
    const aiText = response.text();

    console.log("🟢 Response:", aiText.substring(0, 50) + "...");

    // 8. Return
    return NextResponse.json({ 
      response: aiText,
      audio: null 
    });

  } catch (error: any) {
    console.error("🔴 API Error:", error);
    return NextResponse.json({ 
      response: `Error: ${error.message}. (Check if model 'gemini-2.5-flash' is enabled in your project)` 
    }, { status: 500 });
  }
}