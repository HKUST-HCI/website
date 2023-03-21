import sys
import os.path as path
import re
import json
from datetime import datetime
from collections import namedtuple
import requests
from bs4 import BeautifulSoup

url = 'https://www.cse.ust.hk/~mxj/'

cache_path = path.join(path.dirname(__file__), "cache.html")
if path.exists(cache_path):
    cache_last_modified = path.getmtime(cache_path)
else:
    cache_last_modified = 0
cache_last_modified = datetime.fromtimestamp(cache_last_modified)

head = requests.head(url)
if not head.ok:
    print("Cannot connect to ~mxj website", file=sys.stderr)
    exit(1)

print(head.headers)
online_last_modified = head.headers.get('last-modified').removesuffix(' GMT')
online_last_modified = datetime.strptime(
    online_last_modified, '%a, %d %b %Y %H:%M:%S')
if online_last_modified > cache_last_modified:
    res = requests.get(url)
    if not head.ok:
        print("Cannot connect to ~mxj website", file=sys.stderr)
        exit(1)
    text = res.text
    with open(cache_path, 'w') as fp:
        fp.write(text)
    soup = BeautifulSoup(text, 'lxml')
else:
    with open(cache_path) as fp:
        soup = BeautifulSoup(fp, 'lxml')

pubs = soup.find(id='pub').table

author_re = re.compile(
    r'(\w+(?:,\s*)\w+\.?)(?:(?:,\s)(\w+(?:,\s*)\w+\.?))*')
doi_re = re.compile(
    r'https?://(?:(?:www\.)?doi\.org|https?://dl\.acm\.org/doi)')
Publication = namedtuple('Publication', [
    'category',
    'title',
    'authorLine',
    'venue',
    'year',
    'links',
    'image'])
pub_list: list[Publication] = []
category = ""

for row in pubs.find_all('tr', recursive=False):
    # if the row's first td child is a bold string, remember it
    if row.td.b:
        category = row.td.b.string
    # else, generate a publication dict
    # the thumbnail image link is in the first td child's img src
    # the other information is in the second td child
    else:
        thumbnail = row.td.img['src'] if row.td.img else None
        if thumbnail and not thumbnail.startswith('http'):
            thumbnail = re.sub(r'^\./', '', thumbnail)
            thumbnail = url + thumbnail

        info = row.td.next_sibling

        author_year_title = info.contents[0]
        authorLine, year, title = re.split(
            r'\s*\((\d+)\)\.?\s*', author_year_title)
        title = title.removesuffix('.').removesuffix('. In ')
        year = int(year)

        venue = info.i
        venue = venue.string if venue else None

        if info.span:
            links = {t: a_tag['href']
                     for a_tag in info.span.find_all('a', recursive=False)
                     if (s := a_tag.string.lower() if a_tag.string else None,
                         t := 'url' if s == 'html' else s,
                         t is not None)}
            for href in list(links.values()):
                if doi_re.match(href):
                    links['doi'] = href
        else:
            links = {}

        pub = Publication(category, title, authorLine,
                          venue, year, links, thumbnail)
        pub_list.append(pub._asdict())

for pub in pub_list:
    if pub['links'].get('url', None) == "https://dl.acm.org/doi/abs/10.1145/3555553":
        pub['venue'] = "Proceedings of the ACM on Human-Computer Interaction"

json_path = path.join(path.dirname(__file__), "scrape.json")
with open(json_path, 'w') as fp:
    json.dump(pub_list, fp, indent=4, ensure_ascii=False)

site_data = {}
for pub in pub_list:
    year = pub['year']
    if year not in site_data:
        site_data[year] = [pub]
    else:
        site_data[year].append(pub)
site_data = [{"year": year, "papers": site_data[year]}
             for year in sorted(site_data.keys(), reverse=True)]
site_data_path = path.join(path.dirname(__file__), "publications.json")
with open(site_data_path, 'w') as fp:
    json.dump(site_data, fp, indent=4, ensure_ascii=False)
