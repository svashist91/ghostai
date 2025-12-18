import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// 1. Initialize Supabase (for Auth check)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 2. Initialize AWS S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: Request) {
  try {
    // A. SECURITY: Authenticate the User
    // We check the Authorization header sent by the frontend
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // B. Parse Request
    const { contentType } = await request.json();
    
    // C. Generate Unique File Key
    // Structure: user_id/random-uuid.png
    // This organizes files by user and prevents filename collisions.
    const fileExtension = contentType.split('/')[1] || 'png'; // default to png
    const uniqueFileId = uuidv4();
    const s3Key = `${user.id}/${uniqueFileId}.${fileExtension}`;

    // D. Generate the Presigned URL
    // This tells AWS: "Allow a PUT request for this specific Key for 60 seconds"
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });

    // E. Return the URL and Key to Frontend
    return NextResponse.json({ 
      url: presignedUrl, 
      key: s3Key 
    });

  } catch (error) {
    console.error('S3 Presign Error:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}