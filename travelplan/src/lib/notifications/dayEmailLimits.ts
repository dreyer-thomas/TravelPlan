/**
 * The largest day email the app sends with the document packet attached: the **finished, encoded** mail
 * - headers, both parts, base64 attachment and line breaks - not the PDF (Story 9.3, AC11). Above it the
 * mail goes without the packet and says so. 20 MB is what GMX and most providers accept; at the ~1.37x
 * base64 overhead it admits a packet of about 14.5 MB.
 *
 * Its own module so a route test can `vi.mock` it down to a size a test can afford to build.
 */
export const MAX_DAY_EMAIL_BYTES = 20 * 1024 * 1024;
