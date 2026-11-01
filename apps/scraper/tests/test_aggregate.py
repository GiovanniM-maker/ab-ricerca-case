"""Da apps/scraper: python3 -m unittest discover tests"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rental_radar import aggregate
from rental_radar.aggregate import _affitta_letti, _segna_curati

ED = {"nome": "Sable", "lat": 40.7205, "lng": -74.0348, "url": "https://x.test/sable"}


def scheda(titolo, fonti, url="https://x.test/a", lat=40.7205, lng=-74.0348, visto="2026-11-01"):
    return {"title": titolo, "sources": fonti, "source": fonti[0], "sourceUrl": url,
            "lat": lat, "lng": lng, "visto": visto}


class Letti(unittest.TestCase):
    def test_scarta_chi_affitta_letti(self):
        for t in ("FOUND Study Union Square", "Room in Shared 4 bed/2 bath home",
                  "Webster Apartments- ALL WOMENS HOUSING"):
            self.assertTrue(_affitta_letti({"title": t}), t)
        self.assertTrue(_affitta_letti({"title": "x", "sourceUrl": "https://a.com/found-study-chelsea/"}))

    def test_non_tocca_i_falsi_positivi_visti_nei_dati(self):
        for t, u in (("MONSTER-SIZED 3-BED • IN-UNIT W/D", "https://c.org/3-bed-in-unit-wd"),
                     ("beautiful one bedroom in the heart", "https://c.org/one-bedroom-in-the-heart")):
            self.assertFalse(_affitta_letti({"title": t, "sourceUrl": u}), t)


class Curati(unittest.TestCase):
    def test_tiene_la_fonte_viva_e_toglie_la_gemella(self):
        ferma = scheda("Sable", ["zillow"], lng=-74.0347)
        viva = scheda("Sable", ["apartments"])
        esito = _segna_curati([ferma, viva], [ED], "2026-11-01")
        self.assertEqual(esito, [viva])
        self.assertTrue(viva["curato"])

    def test_senza_fonti_nasce_la_scheda_senza_prezzo(self):
        esito = _segna_curati([], [ED], "2026-11-01")
        self.assertEqual((esito[0]["title"], esito[0]["price"], esito[0]["source"]), ("Sable", None, "curato"))
        self.assertEqual(_segna_curati(esito, [ED], "2026-11-02"), esito)

    def test_stesso_nome_lontano_non_conta(self):
        lontana = scheda("Sable", ["zillow"], lat=40.80)
        self.assertEqual(len(_segna_curati([lontana], [ED], "2026-11-01")), 2)


class Parziali(unittest.TestCase):
    def test_fonte_parziale_non_cancella_le_altre_schede(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            out = d / "listings.json"
            ieri = {"generatedAt": "2026-10-31", "listings": [
                {"id": "a", "chiave": "a", "source": "streeteasy", "sources": ["streeteasy"],
                 "lat": 40.7, "lng": -74.0, "title": "Vecchia", "visto": "2026-09-06"}]}
            out.write_text(json.dumps(ieri))
            snap = d / "streeteasy.snapshot.json"
            snap.write_text("[]")
            argv = ["x", str(snap), "--su-quelle-di-ieri", "--parziali=streeteasy"]
            with mock.patch.object(aggregate, "OUT", out), mock.patch.object(sys, "argv", argv), \
                    mock.patch.object(aggregate, "CURATI", d / "niente.json"):
                aggregate.main()
            l = json.loads(out.read_text())["listings"]
            self.assertEqual([(x["title"], x["visto"]) for x in l], [("Vecchia", "2026-09-06")])


if __name__ == "__main__":
    unittest.main()
