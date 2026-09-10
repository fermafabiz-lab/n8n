-- The scene, fresh, so Needs Image? -> Build Image Request runs again for it
-- in STRICT mode (the judge's reasons wait in static data). Its image column
-- is still empty: the drifted frame was never written.
select id, "createdTime", fields from hov.at_scene
where id = $hov${{ $json.sceneId }}$hov$
