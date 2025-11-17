// Shim for micro's send function to work in Cloudflare Workers
export const send = (res, statusCode, data) => {
  res.statusCode = statusCode;
  res.end(data);
};
