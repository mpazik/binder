type LinkTarget = "_blank" | "_self";

const ABSOLUTE_URL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*?:/;

// Scheme: https://tools.ietf.org/html/rfc3986#section-3.1
// Absolute URL: https://tools.ietf.org/html/rfc3986#section-4.3
export const isAbsoluteUrl = (url: string): boolean =>
  ABSOLUTE_URL_REGEX.test(url);

export function getLinkTarget(url: string): LinkTarget {
  return isAbsoluteUrl(url) ? "_blank" : "_self";
}