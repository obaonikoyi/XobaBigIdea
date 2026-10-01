import { describe, expect, it } from "vitest";
import { makeApp, makeIdea } from "./helpers.js";
import { describeDevice } from "../src/auth.js";

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json", ...headers },
});
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

describe("sign in", () => {
  it("tells the app whether sign-in is needed, without signing in", async () => {
    expect(await (await (await makeApp()).call("/api/auth")).json()).toEqual({ required: false, passwordLogin: false });
    const { call } = await makeApp({ appPassword: "pw" });
    expect(await (await call("/api/auth")).json()).toEqual({ required: true, passwordLogin: true });
  });

  it("gives each device its own session; the same ideas are visible on both", async () => {
    const { call } = await makeApp({ appPassword: "correct horse" });
    expect((await call("/api/ideas")).status).toBe(401);

    const laptop = await (await call("/api/login", json({ password: "correct horse" }, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130" }))).json();
    const phone = await (await call("/api/login", json({ password: "correct horse" }, { "User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile" }))).json();
    expect(laptop.device).toBe("Windows · Chrome");
    expect(phone.device).toBe("Android · Chrome");
    expect(laptop.token).not.toBe(phone.token);

    const put = await call("/api/ideas/idea1", { method: "PUT", body: JSON.stringify(makeIdea()), headers: { "Content-Type": "application/json", Authorization: `Bearer ${laptop.token}` } });
    expect(put.status).toBe(200);
    const onPhone = await (await call("/api/ideas", bearer(phone.token))).json();
    expect(onPhone.ideas.map((i: { id: string }) => i.id)).toEqual(["idea1"]);
  });

  it("rejects wrong passwords and stops guessing after 10 tries", async () => {
    const { call } = await makeApp({ appPassword: "pw" });
    expect((await call("/api/login", json({ password: "nope" }))).status).toBe(401);
    expect((await call("/api/login", json({}))).status).toBe(401);
    for (let i = 0; i < 8; i++) await call("/api/login", json({ password: "nope" }));
    // Even the right password is refused while blocked.
    expect((await call("/api/login", json({ password: "pw" }))).status).toBe(429);
  });

  it("signing out ends only that device; sign out everywhere ends all", async () => {
    const { call } = await makeApp({ appPassword: "pw" });
    const a = (await (await call("/api/login", json({ password: "pw" }))).json()).token;
    const b = (await (await call("/api/login", json({ password: "pw" }))).json()).token;
    expect((await (await call("/api/sessions", bearer(a))).json()).count).toBe(2);

    await call("/api/logout", { method: "POST", ...bearer(a) });
    expect((await call("/api/ideas", bearer(a))).status).toBe(401);
    expect((await call("/api/ideas", bearer(b))).status).toBe(200);

    await call("/api/logout-all", { method: "POST", ...bearer(b) });
    expect((await call("/api/ideas", bearer(b))).status).toBe(401);
  });

  it("still accepts the old fixed app token", async () => {
    const { call } = await makeApp({ appPassword: "pw", appToken: "legacy" });
    expect((await call("/api/ideas", bearer("legacy"))).status).toBe(200);
    expect((await call("/api/ideas", bearer("forged"))).status).toBe(401);
  });

  it("describes common devices", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1")).toBe("iPhone · Safari");
    expect(describeDevice(undefined)).toBe("Unknown device");
  });
});
