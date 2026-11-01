"""Da apps/scraper: python3 -m unittest discover tests"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rental_radar import aggregate
from rental_radar.aggregate import _affitta_letti, _segna_curati
from rental_radar.sources.apartmentadvisor import segnali_unita

ED = {"nome": "Sable", "lat": 40.7205, "lng": -74.0348, "url": "https://x.test/sable"}


def scheda(titolo, fonti, url="https://x.test/a", lat=40.7205, lng=-74.0348, visto="2026-11-01"):
    return {"title": titolo, "sources": fonti, "source": fonti[0], "sourceUrl": url,
            "lat": lat, "lng": lng, "visto": visto}


class TestoUnita(unittest.TestCase):
    def test_304_w_30_st(self):
        testo = "One room apartment. Shared bath in hall, shared with two other apartments."
        self.assertEqual(segnali_unita([testo, testo]), ["unita:bagno-condiviso"])

    def test_bagno_condiviso_solo_se_lo_dicono_tutte(self):
        self.assertEqual(segnali_unita(["Shared bath in hall.", "Large one bedroom."]), [])

    def test_lavatrice_e_lavanderia(self):
        self.assertEqual(segnali_unita(["Washer/dryer in unit, high ceilings."]), ["unita:lavatrice"])
        self.assertEqual(segnali_unita(["Laundry in the building."]), ["unita:lavanderia-edificio"])
        self.assertEqual(segnali_unita(["Great light, dishwasher."]), [])
        self.assertEqual(segnali_unita(["No washer in the apartment."]), [])

    def test_falsi_positivi_lavatrice(self):
        for t in ("Laundry room in the apartment building.", "Washer/dryer hookups in unit.",
                  "Coin laundry in the apartment complex.",
                  "Washer dryer in apartment building basement."):
            self.assertNotIn("unita:lavatrice", segnali_unita([t]), t)

    def test_falsi_positivi_bagno(self):
        for t in ("Private bath, not shared bath.", "Shared bathroom is not required."):
            self.assertNotIn("unita:bagno-condiviso", segnali_unita([t]), t)

    def test_lavatrice_solo_se_lo_dicono_tutte(self):
        self.assertEqual(segnali_unita(["Washer/dryer in unit.", "Sunny studio."]), [])
        self.assertEqual(segnali_unita(["Washer/dryer in unit.", "Laundry in the building."]), [])

    def test_stanza_col_bagno_comune_e_fuori(self):
        self.assertTrue(_affitta_letti({"title": "304 W 30 St", "amenities": ["unita:bagno-condiviso"]}))


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


# ---- pulizie e doppioni (revisione 01/11) ------------------------------------
import re
from datetime import date

from rental_radar.aggregate import (
    FONTI_FERME, _canon_address, _norm_address, _sqft_valida, _stessa_casa,
    _to_public, pulisci_titolo, rifinisci)
from rental_radar.models import Listing
from rental_radar.sources import apartmentadvisor as aa
from rental_radar.sources import craigslist as cl

WEB_LIB = Path(__file__).resolve().parents[2] / "web" / "lib"


def casa(titolo, prezzo=4150, chiave=None, lat=40.7340, lng=-73.9900, tipo="studio", id_="x-1", **kw):
    return {"id": id_, "title": titolo, "price": prezzo, "chiave": chiave, "lat": lat, "lng": lng,
            "type": tipo, "sources": [id_.split("-")[0]], "source": id_.split("-")[0],
            "visto": "2026-11-01", "photos": [], "amenities": [], **kw}


class Sqft(unittest.TestCase):
    def test_range_80_20000(self):
        for v in (-1, 3, 14, 79, 78840, 20001, "x", None):
            self.assertIsNone(_sqft_valida(v), v)
        for v in (80, 450, 20000):
            self.assertEqual(_sqft_valida(v), v)

    def test_to_public_azzera(self):
        it = {"source": "apartmentadvisor", "source_id": "a", "lat": 1, "lng": 2, "sqft": 78840}
        self.assertIsNone(_to_public(it)["sqft"])


class Canonico(unittest.TestCase):
    def test_suffissi_e_direzioni(self):
        self.assertEqual(_canon_address("51 Irving Place"), _canon_address("51 irving pl"))
        self.assertEqual(_canon_address("202 e 13 st"), _canon_address("202 East 13th Street"))
        self.assertEqual(_canon_address("776 Sixth Avenue")[0], _canon_address("776 sixth ave")[0])

    def test_prefissi(self):
        self.assertEqual(_canon_address("Rental open house at 776 Sixth Avenue #17A, NY"),
                         ("776 sixth ave", "17a"))
        self.assertEqual(_canon_address(" Unit 2112 at 10 Halletts Point"), ("10 halletts point", "2112"))
        self.assertEqual(_canon_address("Apt 4B at 5 Main St")[1], "4b")

    def test_senza_civico_niente(self):
        for t in ("fort greene 2-bed 1-bath", "haus25", "via 57 west", "Brooklyn", None):
            self.assertIsNone(_canon_address(t), t)

    def test_la_chiave_pubblicata_non_cambia(self):
        # compatibilita' wishlist (chiave||id): _norm_address resta quella di prima
        self.assertEqual(_norm_address("51 Irving Place, New York, NY"), "51 irving place")
        self.assertEqual(_norm_address("133 W 22nd St #4B"), "133 w 22 st|4b")

    def test_titolo_pulito(self):
        self.assertEqual(pulisci_titolo("Rental open house at 629 W 24th St"), "629 W 24th St")
        self.assertEqual(pulisci_titolo("629 W 24th St"), "629 W 24th St")
        self.assertEqual(_to_public({"source": "s", "title": "Rental open house at 1 A St",
                                     "lat": 1, "lng": 2})["title"], "1 A St")


class Doppioni(unittest.TestCase):
    def test_fonde_stessa_casa_e_conserva_la_chiave(self):
        a = casa("51 Irving Place", chiave="51 irving place", id_="streeteasy-1")
        b = casa("51 Irving Pl", chiave="51 irving pl", id_="apartmentadvisor-2",
                 sqft=400, lng=-73.9901)
        out, c = rifinisci([a, b])
        self.assertEqual(len(out), 1)
        self.assertEqual(c["doppioni_fusi"], 1)
        self.assertEqual(out[0]["chiave"], "51 irving place")
        self.assertEqual(out[0]["sqft"], 400)
        self.assertEqual(sorted(out[0]["sources"]), ["apartmentadvisor", "streeteasy"])
        self.assertIn("51 irving pl", out[0]["chiaviVecchie"])
        self.assertIn("apartmentadvisor-2", out[0]["chiaviVecchie"])

    def test_non_fonde(self):
        base = casa("57 Thompson Street", chiave="57 thompson street|2a", id_="a-1")
        for altra in (
            casa("57 thompson st", chiave="57 thompson st|3b", id_="b-2"),         # altra unita'
            casa("57 thompson st", prezzo=4200, id_="b-3"),                        # altro prezzo
            casa("57 thompson st", lat=40.7440, id_="b-4"),                        # lontana
            casa("57 thompson st", tipo="1br", id_="b-5"),                         # altra tipologia
            casa("58 thompson st", id_="b-6"),                                     # altro civico
            casa("fort greene 2-bed", id_="b-7"),                                  # niente civico
        ):
            self.assertFalse(_stessa_casa(base, altra), altra["title"])

    def test_unita_assente_si_fonde(self):
        self.assertTrue(_stessa_casa(casa("57 Thompson Street", chiave="57 thompson street|2a", id_="a-1"),
                                     casa("57 thompson st", id_="b-2")))

    def test_titolo_vuoto_scartato(self):
        out, c = rifinisci([casa("", id_="zillow-1"), casa("  ", id_="zillow-2"), casa("1 A St", id_="z-3")])
        self.assertEqual([l["id"] for l in out], ["z-3"])
        self.assertEqual(c["titolo_vuoto"], 2)

    def test_rifinisci_sqft_e_titolo(self):
        out, c = rifinisci([casa("Rental open house at 1 A St", sqft=78840)])
        self.assertEqual((out[0]["title"], out[0]["sqft"]), ("1 A St", None))
        self.assertEqual((c["titoli_puliti"], c["sqft_azzerate"]), (1, 1))


class Soglie(unittest.TestCase):
    def test_soglia_per_type_null(self):
        floors = json.loads((WEB_LIB / "price_floors.json").read_text())["floors"]
        self.assertEqual(floors[""], 800)
        self.assertEqual(floors["studio"], 1200)  # le altre invariate

    def test_room_mate(self):
        letti = json.loads((WEB_LIB / "affitto_letti.json").read_text())
        rx = re.compile(letti["titolo"], re.I)
        for t in ("Looking for room mate $650 Mo. Studio", "Roommate wanted", "ROOMMATES"):
            self.assertTrue(rx.search(t), t)
        self.assertFalse(rx.search("Spacious 1BR near the Bedroom Community"))

    def test_fonti_ferme_documentate(self):
        self.assertEqual(FONTI_FERME, {"streeteasy", "zillow", "curato"})


class NuoviCampi(unittest.TestCase):
    def test_aa_ricerca(self):
        e = {"publicID": "p", "address": {"latitude": 1, "longitude": 2, "address1": "1 A St"},
             "minRent": 3000, "maxBedroomCount": 1, "minBathroomCount": 1.5,
             "minAvailableFrom": "2026-11-15T00:00:00Z"}
        pub = _to_public(aa._to_listing(e).__dict__)
        self.assertEqual((pub["baths"], pub["disponibile"]), (1.5, "2026-11-15"))
        self.assertNotIn("pubblicata", pub)  # opzionali: assenti se la fonte tace
        self.assertNotIn("noFee", pub)

    def test_aa_dettaglio(self):
        testo = json.dumps({"pageProps": {"initialPageState": {"activeProperty": {
            "activatedAt": "2026-10-01T10:00:00Z", "description": "Great light. No Fee!",
            "amenities": [], "listedUnits": [
                {"activatedAt": "2026-10-20T10:00:00Z", "availableFrom": "2026-12-01", "bathroomCount": 2},
                {"activatedAt": "2026-10-10T10:00:00Z", "availableFrom": "2026-11-05", "bathroomCount": 1}]}}}})
        l = Listing(source="apartmentadvisor", source_url="u", raw={"baths": 1})
        aa.campi_dettaglio(l, testo)
        self.assertEqual((l.raw["pubblicata"], l.raw["disponibile"], l.raw["baths"], l.raw["noFee"]),
                         ("2026-10-10", "2026-11-05", 1, True))

    def test_aa_dettaglio_rotto_non_rompe(self):
        l = Listing(source="apartmentadvisor", source_url="u")
        aa.campi_dettaglio(l, "<html>")
        self.assertIsNone(l.raw)

    def test_cl_lista(self):
        raw = cl._raw_lista("No Fee Studio", {"baths": "1"})
        self.assertEqual(raw, {"baths": 1, "noFee": True})
        self.assertEqual(cl._raw_lista("Studio", {}), {})

    def test_cl_dettaglio(self):
        html = ('<div class="attrgroup"><span class="attr important"> 3BR / 2Ba </span>'
                '<span class="attr important available-now">available now</span></div>'
                '<p class="postinginfo reveal">posted: <time class="date timeago" '
                'datetime="2026-10-29T14:35:58-0400">2026-10-29 14:35</time></p>'
                'broker fee details: <span class="valu">No Fee</span>')
        l = Listing(source="craigslist", source_url="u")
        cl._campi_dettaglio(l, html, oggi=date(2026, 11, 1))
        self.assertEqual(l.raw, {"baths": 2, "pubblicata": "2026-10-29", "noFee": True,
                                 "disponibile": "2026-11-01"})
        l2 = Listing(source="craigslist", source_url="u")
        cl._campi_dettaglio(l2, '<span class="attr important">available nov 15</span>', oggi=date(2026, 11, 1))
        self.assertEqual(l2.raw, {"disponibile": "2026-11-15"})

    def test_fusione_porta_i_campi(self):
        a = casa("1 A St", id_="a-1")
        a["baths"] = None
        out, _ = rifinisci([a, casa("1 A St", id_="b-2", baths=2, noFee=True, disponibile="2026-12-01")])
        self.assertEqual((out[0]["baths"], out[0]["noFee"], out[0]["disponibile"]), (2, True, "2026-12-01"))
