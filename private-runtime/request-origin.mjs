/** Private access is HTTP over loopback (remote owners use an SSH tunnel).
 * Next reconstructs Request.url using its internal hostname/port, which need not
 * match the browser's tunnel address. Validate the original Host instead. Never
 * trust Forwarded or X-Forwarded-* headers supplied by an arbitrary client.
 */
export function loopbackAuthority(host, origin) {
  if (typeof host !== 'string' || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) {
    throw new Error('Loopback only.');
  }
  let authority;
  try { authority = new URL(`http://${host}`); }
  catch { throw new Error('Invalid host.'); }
  if (authority.port === '0') throw new Error('Invalid host.');
  if (origin != null && origin !== authority.origin) throw new Error('Invalid origin.');
  return authority;
}
