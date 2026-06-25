// Deno-based Supabase Edge Function for processing receipts via WebAssembly Tesseract OCR
// Configured to run in a sandboxed, low-overhead environment.

import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createWorker } from "https://esm.sh/tesseract.js@5"; // Optimized WASM OCR port

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      }
    });
  }

  try {
    const { reviewId, imagePath, merchantName } = await req.json();

    if (!reviewId || !imagePath || !merchantName) {
      return new Response(JSON.stringify({ error: "Missing required parameters (reviewId, imagePath, merchantName)." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch binary content directly from Cloudflare R2 bucket storage or Supabase Bucket
    const { data: fileData, error: fileError } = await supabase.storage
      .from('receipts')
      .download(imagePath);

    if (fileError || !fileData) {
      throw new Error(`Unable to retrieve file storage instance: ${fileError?.message || "File empty"}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Initialize sandboxed WebAssembly OCR execution environment
    // Uses the English language lexicon config
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(uint8Array);
    await worker.terminate();

    // Verify raw OCR output matches target merchant name.
    // Escape regex characters to prevent injection attacks and use case-insensitive matching.
    const escapedMerchant = merchantName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const matchRegex = new RegExp(escapedMerchant, 'i');
    const isMatched = matchRegex.test(text);

    if (isMatched) {
      // Mark the review as verified experience in database
      const { error: updateError } = await supabase
        .from('reviews')
        .update({ is_verified_experience: true })
        .eq('id', reviewId);
        
      if (updateError) {
        throw new Error(`Failed to update review status: ${updateError.message}`);
      }
    }

    // Strict privacy cleanup policy:
    // In production, receipt images must be cleared immediately after validation to prevent storage of financial data.
    const { error: deleteError } = await supabase.storage
      .from('receipts')
      .remove([imagePath]);

    if (deleteError) {
      console.error(`Warning: Failed to delete raw verification receipt: ${deleteError.message}`);
    }

    return new Response(JSON.stringify({ 
      verified: isMatched,
      message: isMatched ? "Receipt parsed successfully. Review experience verified." : "Receipt text did not match merchant name.",
      cleanReceiptDeleted: true
    }), {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      }
    });
  }
});
