// 구글 로그인: 브라우저가 구글에서 받아 온 ID 토큰(credential)이 진짜인지 구글에 물어서 확인한다.
// 비밀번호나 이메일은 저장하지 않고, 구글 계정의 고유 번호(sub)와 이름만 쓴다.
// 서버에 GOOGLE_CLIENT_ID(구글 클라우드 콘솔에서 만든 웹 클라이언트 ID)가 있어야 한다.

export class GoogleAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export async function verifyGoogleIdToken(credential, { clientId, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!clientId) throw new GoogleAuthError('NOT_CONFIGURED', '구글 로그인이 아직 설정되지 않았어요');
  const token = String(credential ?? '');
  if (token.length < 20 || token.length > 4096) throw new GoogleAuthError('INVALID', '구글 로그인 정보가 올바르지 않아요');
  let res;
  try {
    res = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  } catch {
    throw new GoogleAuthError('NETWORK', '구글 서버에 연결하지 못했어요');
  }
  if (!res.ok) throw new GoogleAuthError('INVALID', '구글 로그인 정보가 올바르지 않아요');
  const info = await res.json().catch(() => ({}));
  if (info.aud !== clientId) throw new GoogleAuthError('AUDIENCE', '이 서비스용 구글 로그인이 아니에요');
  if (!ISSUERS.includes(info.iss)) throw new GoogleAuthError('INVALID', '구글 로그인 정보가 올바르지 않아요');
  if (!(Number(info.exp) * 1000 > now())) throw new GoogleAuthError('EXPIRED', '구글 로그인이 만료됐어요. 다시 시도해 주세요');
  if (!info.sub) throw new GoogleAuthError('INVALID', '구글 로그인 정보가 올바르지 않아요');
  return { sub: String(info.sub), name: String(info.name ?? info.given_name ?? '') };
}
