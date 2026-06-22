"""Registro delle fonti note: nome -> URL di ricerca per Flatiron.

Cosi' il crawl si lancia con `--source apartmentadvisor` senza incollare l'URL.
"""

SEARCH_URLS: dict[str, str] = {
    "apartmentadvisor": "https://www.apartmentadvisor.com/apartments/flatiron-district-new-york-ny",
    "craigslist": "https://newyork.craigslist.org/search/mnh/aap?query=flatiron&availabilityMode=0",
    "renthop": "https://www.renthop.com/apartments-for-rent/flatiron-district-new-york-ny",
    "trulia": "https://www.trulia.com/for_rent/New_York,Flatiron_District,NY/",
}


def url_for(source: str) -> str | None:
    return SEARCH_URLS.get(source)
