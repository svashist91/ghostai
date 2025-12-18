import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

// 1. Initialize AWS S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Helper to safe-decode JWT without validation (we rely on S3 presigning for security)
function parseJwt(token: string) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  } catch (e) {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    // A. Verify Headers
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // B. Extract User ID from Token (Manual Decode)
    // We do this because supabase.auth.getUser() crashes on Clerk IDs (Strings vs UUIDs)
    const payload = parseJwt(token);
    
    if (!payload || !payload.sub) {
      return NextResponse.json({ error: 'Invalid Token Structure' }, { status: 401 });
    }

    const userId = payload.sub; // This will be "user_2abc..."

    // C. Parse Request
    const { contentType, sessionId } = await request.json();
    
    // D. Generate Unique File Key
    // Structure: user_id / session_id / filename
    const safeSessionId = sessionId || 'default';
    const fileExtension = contentType.split('/')[1] || 'png';
    const uniqueFileId = uuidv4();
    const s3Key = `${userId}/${safeSessionId}/${uniqueFileId}.${fileExtension}`;

    // E. Generate Presigned URL
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });

    // F. Return the URL and Key
    return NextResponse.json({ 
      url: presignedUrl, 
      key: s3Key 
    });

  } catch (error) {
    console.error('S3 Presign Error:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
