import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.srt import build_cues, format_timestamp, render_srt, render_vtt, wrap_text


class TestTimestamps(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(format_timestamp(0), "00:00:00,000")

    def test_seconds_and_milliseconds(self):
        self.assertEqual(format_timestamp(1.5), "00:00:01,500")
        self.assertEqual(format_timestamp(61.25), "00:01:01,250")

    def test_hours(self):
        self.assertEqual(format_timestamp(3661.001), "01:01:01,001")

    def test_negative_is_clamped(self):
        self.assertEqual(format_timestamp(-5), "00:00:00,000")


class TestWrapping(unittest.TestCase):
    def test_short_text_stays_on_one_line(self):
        self.assertEqual(wrap_text("Kurzer Text", 40), "Kurzer Text")

    def test_long_text_is_wrapped(self):
        text = "Dies ist ein deutlich laengerer Satz der umgebrochen werden muss"
        wrapped = wrap_text(text, 20)
        self.assertIn("\n", wrapped)
        self.assertLessEqual(len(wrapped.split("\n")), 2)

    def test_collapses_whitespace(self):
        self.assertEqual(wrap_text("  viel    Abstand  ", 40), "viel Abstand")

    def test_empty_stays_empty(self):
        self.assertEqual(wrap_text("   ", 40), "")


class TestCues(unittest.TestCase):
    def test_builds_one_cue_per_short_segment(self):
        cues = build_cues([(0.0, 2.0, "Hallo Welt")], 40, False)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "Hallo Welt")
        self.assertEqual(cues[0].index, 1)

    def test_splits_long_segments(self):
        long_text = " ".join(["Wort"] * 40)
        cues = build_cues([(0.0, 18.0, long_text)], 40, False, max_cue_sec=6.0)
        self.assertGreater(len(cues), 1)
        self.assertLessEqual(cues[-1].end, 18.0)

    def test_uppercase_option(self):
        cues = build_cues([(0.0, 2.0, "leise")], 40, True)
        self.assertEqual(cues[0].text, "LEISE")

    def test_skips_empty_segments(self):
        cues = build_cues([(0.0, 1.0, "   "), (1.0, 2.0, "Text")], 40, False)
        self.assertEqual(len(cues), 1)

    def test_indexes_are_continuous(self):
        cues = build_cues([(0.0, 2.0, "Eins"), (2.0, 4.0, "Zwei"), (4.0, 6.0, "Drei")], 40, False)
        self.assertEqual([cue.index for cue in cues], [1, 2, 3])


class TestRendering(unittest.TestCase):
    def setUp(self):
        self.cues = build_cues([(0.0, 2.5, "Erster Satz"), (2.5, 5.0, "Zweiter Satz")], 40, False)

    def test_srt_format(self):
        output = render_srt(self.cues)
        self.assertIn("1\n00:00:00,000 --> 00:00:02,500\nErster Satz", output)
        self.assertIn("2\n", output)

    def test_vtt_header_and_dot_separator(self):
        output = render_vtt(self.cues)
        self.assertTrue(output.startswith("WEBVTT"))
        self.assertIn("00:00:00.000 --> 00:00:02.500", output)

    def test_empty_input(self):
        self.assertEqual(render_srt([]), "")


if __name__ == "__main__":
    unittest.main()
