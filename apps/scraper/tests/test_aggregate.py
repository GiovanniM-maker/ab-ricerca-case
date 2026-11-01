"""Da apps/scraper: python3 -m unittest discover tests"""
import unittest

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


if __name__ == "__main__":
    unittest.main()
