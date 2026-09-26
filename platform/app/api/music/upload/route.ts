// A producer adds a track to the music library (multipart: `file`, `group`).
// Behind the site's login like every page (middleware.ts): no key here.
import { cleanGroup, storeTrack } from "@/lib/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, message: "Trimite fișierul ca formular (file, group)." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, message: "Nu am primit niciun fișier." }, { status: 400 });
  try {
    const track = await storeTrack({
      name: file.name,
      group: cleanGroup(form.get("group")),
      buf: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || null,
      source: "upload",
    });
    return Response.json({ ok: true, track });
  } catch (e) {
    return Response.json({ ok: false, message: `Nu am putut salva piesa: ${(e as Error).message}` }, { status: 400 });
  }
}
