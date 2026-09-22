import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.adapters import media_tools
from app.adapters.media_tools import derive_keywords, fit_clip, ken_burns, orientation_for


class RecordingFfmpeg:
    def __init__(self, testcase, duration=0.0):
        self.testcase = testcase
        self.duration = duration
        self.args = None

    def __enter__(self):
        self._ffmpeg = media_tools.run_ffmpeg
        self._probe = media_tools.probe_duration
        media_tools.run_ffmpeg = self._capture
        media_tools.probe_duration = lambda path: self.duration
        return self

    def __exit__(self, *exc):
        media_tools.run_ffmpeg = self._ffmpeg
        media_tools.probe_duration = self._probe
        return False

    def _capture(self, args, timeout=900):
        self.args = args

    @property
    def filters(self):
        return self.args[self.args.index("-vf") + 1]


class TestStichwoerter(unittest.TestCase):
    def test_explizite_stichwoerter_haben_vorrang(self):
        self.assertEqual(derive_keywords("ein langer Prompt", ["night sky", "stars"]), ["night sky", "stars"])

    def test_leere_explizite_liste_faellt_auf_den_prompt_zurueck(self):
        self.assertEqual(derive_keywords("Vulkan Ausbruch", ["  ", ""]), ["Vulkan", "Ausbruch"])

    def test_fuellwoerter_werden_ausgelassen(self):
        picked = derive_keywords("the cinematic view of a volcano", None)
        self.assertNotIn("the", picked)
        self.assertNotIn("cinematic", picked)
        self.assertIn("volcano", picked)

    def test_stilangaben_des_skripts_werden_ausgelassen(self):
        self.assertEqual(derive_keywords("Nordlichter, weite Einstellung, langsame Kamerafahrt", None), ["Nordlichter"])

    def test_doppelungen_werden_entfernt(self):
        self.assertEqual(derive_keywords("Regen regen REGEN Wald", None), ["Regen", "Wald"])

    def test_anzahl_ist_begrenzt(self):
        self.assertEqual(len(derive_keywords("alpha beta gamma delta epsilon zeta", None)), 4)
        self.assertEqual(len(derive_keywords("alpha beta gamma delta", None, limit=2)), 2)

    def test_umlaute_bleiben_erhalten(self):
        self.assertIn("Höhle", derive_keywords("Höhle", None))

    def test_kurze_woerter_werden_ignoriert(self):
        self.assertEqual(derive_keywords("am zu Meer", None), ["Meer"])

    def test_leerer_prompt_ergibt_leere_liste(self):
        self.assertEqual(derive_keywords("", None), [])
        self.assertEqual(derive_keywords(None, None), [])


class TestAusrichtung(unittest.TestCase):
    def test_hochformat(self):
        self.assertEqual(orientation_for(1080, 1920), "portrait")

    def test_querformat(self):
        self.assertEqual(orientation_for(1920, 1080), "landscape")

    def test_quadratisch(self):
        self.assertEqual(orientation_for(1080, 1080), "square")

    def test_leichte_abweichung_bleibt_quadratisch(self):
        self.assertEqual(orientation_for(1080, 1150), "square")


class TestClipAnpassung(unittest.TestCase):
    def test_kurzes_material_wird_wiederholt(self):
        with RecordingFfmpeg(self, duration=2.0) as run:
            fit_clip("a.mp4", "b.mp4", 1080, 1920, 30, 6.0)
        self.assertIn("-stream_loop", run.args)

    def test_langes_material_wird_nur_beschnitten(self):
        with RecordingFfmpeg(self, duration=20.0) as run:
            fit_clip("a.mp4", "b.mp4", 1080, 1920, 30, 6.0)
        self.assertNotIn("-stream_loop", run.args)
        self.assertEqual(run.args[run.args.index("-t") + 1], "6.000")

    def test_zielformat_steht_im_filter(self):
        with RecordingFfmpeg(self, duration=20.0) as run:
            fit_clip("a.mp4", "b.mp4", 1080, 1920, 30, 6.0)
        self.assertIn("crop=1080:1920", run.filters)
        self.assertIn("fps=30", run.filters)

    def test_ton_wird_verworfen(self):
        with RecordingFfmpeg(self, duration=20.0) as run:
            fit_clip("a.mp4", "b.mp4", 1080, 1920, 30, 6.0)
        self.assertIn("-an", run.args)


class TestKenBurns(unittest.TestCase):
    def test_ohne_bewegung_kein_zoompan(self):
        with RecordingFfmpeg(self) as run:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "none", 0.4, 0)
        self.assertNotIn("zoompan", run.filters)

    def test_staerke_null_verhaelt_sich_wie_ohne_bewegung(self):
        with RecordingFfmpeg(self) as run:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "kenburns", 0.0, 0)
        self.assertNotIn("zoompan", run.filters)

    def test_zoom_in_waechst(self):
        with RecordingFfmpeg(self) as run:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "zoom-in", 0.4, 0)
        self.assertIn("zoompan", run.filters)
        self.assertIn("min(zoom+", run.filters)

    def test_zoom_out_schrumpft(self):
        with RecordingFfmpeg(self) as run:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "zoom-out", 0.4, 0)
        self.assertIn("max(", run.filters)

    def test_schwenk_bewegt_die_x_achse(self):
        with RecordingFfmpeg(self) as run:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "pan-right", 0.4, 0)
        self.assertIn("+(on/150)*(iw*0.08)", run.filters)

        with RecordingFfmpeg(self) as run:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "pan-left", 0.4, 0)
        self.assertIn("-(on/150)*(iw*0.08)", run.filters)

    def test_kenburns_wechselt_je_szene(self):
        seen = []
        for index in range(4):
            with RecordingFfmpeg(self) as run:
                ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "kenburns", 0.4, index)
            seen.append(run.filters)
        self.assertEqual(len(set(seen)), 4)

    def test_kenburns_wiederholt_sich_nach_vier_szenen(self):
        with RecordingFfmpeg(self) as first:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "kenburns", 0.4, 0)
        with RecordingFfmpeg(self) as fifth:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "kenburns", 0.4, 4)
        self.assertEqual(first.filters, fifth.filters)

    def test_zielgroesse_steht_im_zoompan(self):
        with RecordingFfmpeg(self) as run:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "zoom-in", 0.4, 0)
        self.assertIn("s=1080x1920", run.filters)
        self.assertIn("scale=2160:3840", run.filters)

    def test_staerke_wird_gedeckelt(self):
        with RecordingFfmpeg(self) as run:
            ken_burns("a.jpg", "b.mp4", 1080, 1920, 30, 5.0, "zoom-in", 5.0, 0)
        self.assertIn("1.3500", run.filters)


if __name__ == "__main__":
    unittest.main()
