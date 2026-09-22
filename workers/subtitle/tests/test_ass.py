import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.ass import Word, build_header, escape_text, format_time, hex_to_ass, render_ass
from app.srt import Cue


def style(**overrides):
    base = {
        "font": "Inter",
        "fontSize": 48,
        "primaryColor": "#FFFFFF",
        "outlineColor": "#000000",
        "highlightColor": "#FACC15",
        "backgroundColor": None,
        "position": "bottom",
        "marginVertical": 120,
        "bold": True,
        "animation": "none",
    }
    base.update(overrides)
    return base


class TestColors(unittest.TestCase):
    def test_rgb_wird_zu_bgr(self):
        self.assertEqual(hex_to_ass("#FF0000"), "&H000000FF")
        self.assertEqual(hex_to_ass("#0000FF"), "&H00FF0000")

    def test_kurzform_wird_aufgefuellt(self):
        self.assertEqual(hex_to_ass("#FA0"), hex_to_ass("#FFAA00"))

    def test_alpha_wird_vorangestellt(self):
        self.assertTrue(hex_to_ass("#FFFFFF", "40").startswith("&H40"))

    def test_unvollstaendiger_wert_bricht_nicht_ab(self):
        self.assertEqual(len(hex_to_ass("#AB")), 10)


class TestZeitformat(unittest.TestCase):
    def test_null(self):
        self.assertEqual(format_time(0), "0:00:00.00")

    def test_minuten_und_hundertstel(self):
        self.assertEqual(format_time(61.25), "0:01:01.25")

    def test_stunden(self):
        self.assertEqual(format_time(3661.5), "1:01:01.50")

    def test_negativ_wird_auf_null_gesetzt(self):
        self.assertEqual(format_time(-3), "0:00:00.00")


class TestEscaping(unittest.TestCase):
    def test_geschweifte_klammern_werden_entschaerft(self):
        self.assertEqual(escape_text("{fett}"), "(fett)")

    def test_zeilenumbruch_wird_ass_umbruch(self):
        self.assertEqual(escape_text("eins\nzwei"), "eins\\Nzwei")


class TestHeader(unittest.TestCase):
    def test_aufloesung_steht_im_header(self):
        header = build_header(style(), 1080, 1920)
        self.assertIn("PlayResX: 1080", header)
        self.assertIn("PlayResY: 1920", header)

    def test_schriftgroesse_skaliert_mit_der_hoehe(self):
        small = build_header(style(fontSize=48), 540, 960)
        large = build_header(style(fontSize=48), 1080, 1920)
        self.assertIn("Inter,24,", small)
        self.assertIn("Inter,48,", large)

    def test_karaoke_faerbt_das_aktive_wort(self):
        header = build_header(style(animation="karaoke"), 1080, 1920)
        self.assertEqual(header.split("Style: Default,")[1].split(",")[2], hex_to_ass("#FACC15"))

    def test_position_bestimmt_alignment(self):
        self.assertIn(",8,", build_header(style(position="top"), 1080, 1920).split("Style: Default,")[1])
        self.assertIn(",5,", build_header(style(position="center"), 1080, 1920).split("Style: Default,")[1])

    def test_hintergrund_setzt_borderstyle_drei(self):
        header = build_header(style(backgroundColor="#101010"), 1080, 1920)
        fields = header.split("Style: Default,")[1].split(",")
        self.assertEqual(fields[15], "3")


class TestRendern(unittest.TestCase):
    def setUp(self):
        self.cues = [Cue(index=1, start=0.0, end=2.0, text="Hallo Welt")]
        self.words = [Word(0.0, 0.8, "Hallo"), Word(0.9, 2.0, "Welt")]

    def test_statisch_erzeugt_eine_zeile(self):
        out = render_ass(self.cues, [], style(), 1080, 1920)
        dialogues = [line for line in out.splitlines() if line.startswith("Dialogue:")]
        self.assertEqual(len(dialogues), 1)
        self.assertTrue(dialogues[0].endswith("Hallo Welt"))

    def test_fade_setzt_den_fad_tag(self):
        out = render_ass(self.cues, [], style(animation="fade"), 1080, 1920)
        self.assertIn(r"{\fad(120,120)}", out)

    def test_pop_erzeugt_eine_zeile_pro_wort(self):
        out = render_ass(self.cues, self.words, style(animation="pop"), 1080, 1920)
        dialogues = [line for line in out.splitlines() if line.startswith("Dialogue:")]
        self.assertEqual(len(dialogues), 2)
        self.assertIn(r"\fscx118", dialogues[0])

    def test_pop_ohne_woerter_faellt_auf_cues_zurueck(self):
        out = render_ass(self.cues, [], style(animation="pop"), 1080, 1920)
        dialogues = [line for line in out.splitlines() if line.startswith("Dialogue:")]
        self.assertEqual(len(dialogues), 1)

    def test_karaoke_setzt_k_tags_pro_wort(self):
        out = render_ass(self.cues, self.words, style(animation="karaoke"), 1080, 1920)
        dialogues = [line for line in out.splitlines() if line.startswith("Dialogue:")]
        self.assertEqual(len(dialogues), 1)
        self.assertEqual(dialogues[0].count(r"{\k"), 3)

    def test_karaoke_ohne_passende_woerter_bleibt_lesbar(self):
        words = [Word(10.0, 11.0, "spaeter")]
        out = render_ass(self.cues, words, style(animation="karaoke"), 1080, 1920)
        self.assertIn("Hallo Welt", out)

    def test_leere_cues_erzeugen_keine_zeile(self):
        out = render_ass([Cue(index=1, start=0.0, end=1.0, text="  ")], [], style(), 1080, 1920)
        self.assertEqual([line for line in out.splitlines() if line.startswith("Dialogue:")], [])

    def test_pop_gibt_sehr_kurzen_woertern_mindestdauer(self):
        words = [Word(0.0, 0.0, "Hey")]
        out = render_ass(self.cues, words, style(animation="pop"), 1080, 1920)
        line = [entry for entry in out.splitlines() if entry.startswith("Dialogue:")][0]
        start, end = line.split(",")[1], line.split(",")[2]
        self.assertNotEqual(start, end)


if __name__ == "__main__":
    unittest.main()
