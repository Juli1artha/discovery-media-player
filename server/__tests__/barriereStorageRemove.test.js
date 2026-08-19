// LA DERNIÈRE BARRIÈRE, TESTÉE EN DIRECT — storage.remove du contexte autonome.
//
// ⚠️ La revalidation dans retention.js est une barrière ; storage.remove en est une AUTRE, à la
// frontière du DELETE service_role (P1 huitième audit). Elle mérite son propre essai : un autre
// bucket refusé, une traversée `..` refusée, sa forme encodée refusée, un chemin valide accepté —
// et `fetch` n'est JAMAIS appelé sur une valeur rejetée (sinon la garde ne garde rien).

const { createStandaloneContext } = require("../../context/standalone.js");

function contexte() {
  const appels = [];
  const vraiFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { appels.push(String(url)); return { ok: true }; };
  const ctx = createStandaloneContext({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srv" });
  return { remove: ctx.storage.remove.bind(ctx.storage), appels, restaurer: () => { globalThis.fetch = vraiFetch; } };
}

describe("storage.remove — bucket et traversée", () => {
  it("un chemin valide du bucket est supprimé (fetch appelé une fois, sur la bonne URL)", async () => {
    const { remove, appels, restaurer } = contexte();
    const ok = await remove("present-attachments", "s-a/photo.png");
    expect(ok).toBe(true);
    expect(appels.length).toBe(1);
    expect(appels[0]).toContain("/storage/v1/object/present-attachments/s-a/photo.png");
    restaurer();
  });

  for (const [nom, bucket, chemin] of [
    ["un autre bucket", "autre-bucket", "s-a/photo.png"],
    ["une traversée ..", "present-attachments", "../autre-bucket/secret.pdf"],
    ["un segment .", "present-attachments", "s-a/./x.png"],
    ["une forme encodée %2e", "present-attachments", "%2e%2e/x.png"],
    ["un antislash", "present-attachments", "s-a\\x.png"],
    ["un segment vide", "present-attachments", "s-a//x.png"],
  ]) {
    it(`refuse ${nom} SANS appeler fetch`, async () => {
      const { remove, appels, restaurer } = contexte();
      const ok = await remove(bucket, chemin);
      expect(ok, `${nom} doit être refusé`).toBe(false);
      expect(appels.length, "aucun DELETE réseau sur une valeur rejetée").toBe(0);
      restaurer();
    });
  }
});
