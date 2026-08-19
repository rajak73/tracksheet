const BASE_URL = `http://127.0.0.1:${process.env.TEST_PORT ?? 3100}`;

/**
 * A deliberately dumb raw-HTTP client. It holds a cookie string and nothing
 * else — no app code, no Prisma, no React. The Phase 1 gate requires proving
 * that tenant isolation is enforced server-side, which only means something if
 * the test can reach the API the way an attacker would: with curl-equivalent
 * requests that never touch the frontend.
 */
export class ApiClient {
  private cookie = "";

  constructor(readonly label: string) {}

  async request(path: string, init: RequestInit = {}) {
    // A multipart body must NOT carry a content-type header: fetch generates one
    // containing the boundary it chose, and setting the header by hand — even to
    // the right value — produces a body the server cannot parse. So the JSON
    // default is omitted rather than overridden when the body is form data.
    const isForm = init.body instanceof FormData;

    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(isForm ? {} : { "content-type": "application/json" }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(init.headers ?? {}),
      },
      redirect: "manual",
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookie) {
      const pair = raw.split(";")[0];
      if (pair) this.cookie = pair;
    }

    const text = await res.text();
    // Deliberately untyped: these tests assert on raw wire responses, and
    // importing app types here would couple the probe to the code under test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return { status: res.status, body };
  }

  get(path: string) {
    return this.request(path, { method: "GET" });
  }

  /**
   * Uploads a file the way a browser does — real multipart, real boundary.
   *
   * `filename` and `contentType` are separate arguments on purpose: the server
   * is supposed to decide what a file IS from its bytes, and the only way to
   * prove that is to lie in the name and the declared type.
   */
  upload(path: string, bytes: Uint8Array | string, filename: string, contentType: string) {
    const form = new FormData();
    const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    form.append("file", new Blob([data as unknown as BlobPart], { type: contentType }), filename);
    return this.request(path, {
      method: "POST",
      body: form,
      // `connection: close` so the socket is never returned to the keep-alive
      // pool. Several of these uploads are REFUSED — a manager gets 403 and a
      // JSON body gets 415 — and the refusal happens before the handler reads
      // the multipart body, leaving a request undrained on that socket. Reusing
      // it afterwards wedges the pool, and every later request in this worker
      // queues behind it: whichever test file ran next then timed out with no
      // CPU, memory or database symptom to point at. A fresh connection per
      // upload costs nothing here and keeps the failure impossible.
      headers: { connection: "close" },
    });
  }

  post(path: string, json?: unknown) {
    return this.request(path, {
      method: "POST",
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  }

  patch(path: string, json?: unknown) {
    return this.request(path, {
      method: "PATCH",
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  }

  delete(path: string) {
    return this.request(path, { method: "DELETE" });
  }

  async login(email: string, password = "Password123!") {
    const res = await this.post("/api/auth/login", { email, password });
    if (res.status !== 200) {
      throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as {
      user: {
        id: string;
        role: string;
        universityId: string | null;
        instructorId: string | null;
      };
    };
  }

  /** Drops the cookie without calling logout — simulates an anonymous caller. */
  forgetCookie() {
    this.cookie = "";
  }

  /**
   * The raw session cookie currently held. Needed to prove that logout revokes
   * the session SERVER-side: clearing the cookie only stops a cooperating
   * client, whereas replaying a captured cookie is what an attacker would do.
   */
  captureCookie(): string {
    return this.cookie;
  }

  /** Replays a previously captured cookie, bypassing any client-side clearing. */
  restoreCookie(cookie: string) {
    this.cookie = cookie;
  }
}

export const ACCOUNTS = {
  admin: "admin@example.edu",
  managerNorth: "manager.north@example.edu",
  managerWest: "manager.west@example.edu",
  instructorNorth1: "inst.north1@example.edu",
  instructorNorth2: "inst.north2@example.edu",
  instructorWest1: "inst.west1@example.edu",
} as const;
