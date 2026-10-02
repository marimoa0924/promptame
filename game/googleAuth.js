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

// 구글 콘솔에서 내려받은 OAuth 클라이언트 JSON(client_secret_….json)에서 클라이언트 ID만 꺼낸다.
// 파일에는 비밀번호(client_secret)도 들어 있지만 이 서비스는 쓰지 않고 읽지도 않는다.
// 결과: { clientId, type } 또는 null. type은 'web'(맞음), 'installed'(데스크톱 앱용이라 웹 로그인에 못 씀) 등.
export function clientIdFromJson(text) {
  let json;
  try {
    json = JSON.parse(String(text));
  } catch {
    return null;
  }
  for (const type of ['web', 'installed']) {
    const id = json?.[type]?.client_id;
    if (typeof id === 'string' && id.trim()) return { clientId: id.trim(), type };
  }
  return null;
}

// 구글에 이 클라이언트 ID가 실제로 있는지 물어본다(서버를 켤 때 한 번). 구글은 모르는 ID로 로그인을 시작하면
// /signin/oauth/error 페이지로 보내면서 오류 이름(invalid_client 등)을 주소에 담는다. 그것을 읽는다.
// 결과: { status: 'FOUND' | 'NOT_FOUND' | 'UNKNOWN', detail }
export async function checkClientId(clientId, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, response_type: 'token', scope: 'openid', redirect_uri: 'http://localhost' })}`;
    const res = await fetchImpl(url, { redirect: 'manual' });
    const loc = res.headers?.get?.('location') ?? '';
    const m = loc.match(/[?&]authError=([^&]+)/);
    if (!m) return { status: 'FOUND', detail: '' }; // 오류 페이지로 안 보내면 로그인 화면으로 가는 중이라는 뜻이다
    const text = Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8');
    if (/invalid_client/.test(text)) return { status: 'NOT_FOUND', detail: text.replace(/[^\x20-\x7e]+/g, ' ').trim() };
    return { status: 'FOUND', detail: text.replace(/[^\x20-\x7e]+/g, ' ').trim() }; // 예: redirect_uri_mismatch는 ID는 있다는 뜻
  } catch (err) {
    return { status: 'UNKNOWN', detail: String(err?.message ?? err) };
  }
}
