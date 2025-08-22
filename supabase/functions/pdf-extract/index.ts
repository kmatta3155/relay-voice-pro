import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing PDF file: ${file.name}, size: ${file.size} bytes`);

    // Convert file to base64 for PDF processing
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    // Use a PDF extraction API service or simple text extraction
    // For now, we'll use a basic approach and suggest manual text entry
    // In production, you'd want to use a service like PDF.js or similar
    
    // Simple fallback - return instruction for manual extraction
    const extractedText = `PDF file "${file.name}" was uploaded successfully. 
    
Please copy and paste the text content from your PDF into the manual text area below, or try converting your PDF to a text file first.

The PDF contains ${Math.round(file.size / 1024)}KB of data.`;

    return new Response(JSON.stringify({ 
      text: extractedText,
      filename: file.name,
      size: file.size,
      success: true,
      message: "PDF received - please paste text content manually for best results"
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in pdf-extract function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      message: "PDF processing failed - please copy and paste text content manually"
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});