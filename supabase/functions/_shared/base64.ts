// Base64 encoding/decoding utilities for edge functions

export function base64Encode(data: Uint8Array): string {
  // Convert Uint8Array to string of characters
  let binaryString = '';
  for (let i = 0; i < data.length; i++) {
    binaryString += String.fromCharCode(data[i]);
  }
  // Use btoa for base64 encoding
  return btoa(binaryString);
}

export function base64Decode(base64: string): Uint8Array {
  // Use atob for base64 decoding
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}