import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from automation import monthly_update as update


class MonthlyUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / "automation" / "data"
        self.site_data = self.root / "src" / "data"
        self.scripts = self.root / "scripts"
        for directory in (self.data, self.site_data, self.scripts):
            directory.mkdir(parents=True)
        shutil.copy2(update.PROJECT_ROOT / "scripts" / "sync-approved-content.js", self.scripts)
        self.people = self.root / "people.json"
        self.write(self.people, [
            {"type": "Current Members", "members": [
                {"name": "Alice Example", "position": "PhD Student"},
                {"name": "Bob Researcher", "position": "Postdoc"},
                {"name": "Clara Student", "position": "MPhil Student"},
                {"name": "Faculty Person", "position": "Professor"},
                {"name": "Undergrad Person", "position": "UG Student"},
            ]},
            {"type": "Past Members", "members": [
                {"name": "Alumni Person", "position": "PhD"},
            ]},
        ])
        self.write(self.data / "approved-publications.json", {"items": []})
        self.write(self.data / "approved-news.json", {"items": []})
        self.write(self.data / "review.json", {"batchId": "fixture", "news": []})
        self.write(self.site_data / "publications.json", [])
        self.write(self.site_data / "news.json", [])

    @staticmethod
    def write(path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @staticmethod
    def read(path):
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def paper(**changes):
        return {
            "id": "scholar-publication-1",
            "year": 2026,
            "title": "Example research",
            "authorLine": "A Example, B Researcher",
            "venue": "Example Conference",
            "decision": "approved",
            **changes,
        }

    def approved(self):
        return self.read(self.data / "approved-publications.json")["items"]

    def site(self):
        return self.read(self.site_data / "publications.json")

    def run_sync(self):
        return subprocess.run(
            ["node", str(self.scripts / "sync-approved-content.js")],
            check=True, capture_output=True, text=True,
        )

    def approve_papers(self, items, review_extra=None):
        self.write(self.data / "review.json", {"batchId": "fixture", "news": [], **(review_extra or {})})
        payload = {
            "reviewerName": "Test Reviewer",
            "reviewDate": "2026-11-23",
            "confirmed": True,
            "news": [],
            "publications": copy.deepcopy(items),
        }
        with patch.object(update, "sync_and_build_site", side_effect=self.run_sync):
            ok, message = update.approve(self.data, self.people, payload)
        self.assertTrue(ok, message)

    def test_people_source_and_eligibility(self):
        self.assertEqual(
            [person["name"] for person in update.load_current_people(self.people)],
            ["Alice Example", "Bob Researcher", "Clara Student", "Faculty Person", "Undergrad Person"],
        )
        self.assertEqual(update.load_current_member_names(self.people), [
            "Alice Example", "Bob Researcher", "Clara Student",
        ])
        config = self.read(update.ROOT / "config.json")
        self.assertEqual((update.ROOT / config["people_file"]).resolve(), update.PROJECT_ROOT / "src/data/people.json")

    def test_missing_or_empty_current_group_fails(self):
        for groups in ([], [{"type": "Past Members", "members": [{"name": "Alumni Person", "position": "PhD"}]}],
                       [{"type": "Current Members", "members": []}]):
            with self.subTest(groups=groups):
                self.write(self.people, groups)
                with self.assertRaisesRegex(ValueError, "Current Members"):
                    update.load_current_people(self.people)
        self.write(self.people, [{"type": "Current Members", "members": [{"name": "Alice Example"}]}])
        with self.assertRaisesRegex(ValueError, "name and position"):
            update.load_current_people(self.people)

    def test_incremental_approval_preserves_history_and_site(self):
        old = [self.paper(id=f"scholar-publication-{i + 1}", title=f"Existing research {i}") for i in range(14)]
        legacy = {"year": 2024, "papers": [{
            "title": "Legacy", "image": "img/legacy.png",
            "links": {"url": "https://example.org/legacy"}, "custom": "keep",
        }]}
        self.write(self.data / "approved-publications.json", {"items": copy.deepcopy(old)})
        self.write(self.site_data / "publications.json", [{"year": 2026, "papers": copy.deepcopy(old)}, legacy])
        incoming = self.paper(title="New research", doi="10.1234/New")
        self.approve_papers([incoming])
        titles = {item["title"] for item in old} | {"New research"}
        self.assertEqual(len(self.approved()), 15)
        self.assertEqual({item["title"] for item in self.approved()}, titles)
        site = self.site()
        self.assertEqual(len(site[0]["papers"]), 15)
        self.assertEqual({item["title"] for item in site[0]["papers"]}, titles)
        self.assertEqual(site[1], legacy)
        self.approve_papers([self.paper(id="different", title="New research", doi="https://doi.org/10.1234/new")])
        self.assertEqual(len(self.approved()), 15)
        self.assertEqual(len(self.site()[0]["papers"]), 15)

    def test_metadata_update_without_doi_preserves_assets(self):
        old = self.paper(title="Example research: interfaces", authorLine="Alice Example",
                         image="img/paper.png", category="Journal", notes="keep")
        site_paper = {**old, "authors": ["Alice Example"], "links": {
            "url": "https://example.org/paper", "pdf": "/paper.pdf", "video": "https://example.org/video",
        }}
        self.write(self.data / "approved-publications.json", {"items": [old]})
        self.write(self.site_data / "publications.json", [{"year": 2026, "papers": [site_paper]}])
        incoming = self.paper(title="EXAMPLE RESEARCH - INTERFACES", venue="Updated Journal", image="", category="")
        self.approve_papers([incoming])
        approved = self.approved()
        self.assertEqual(len(approved), 1)
        self.assertEqual(approved[0]["venue"], "Updated Journal")
        self.assertEqual(approved[0]["image"], "img/paper.png")
        self.assertEqual(approved[0]["notes"], "keep")
        site = self.site()
        self.assertEqual(len(site[0]["papers"]), 1)
        result = site[0]["papers"][0]
        self.assertEqual(result["venue"], "Updated Journal")
        self.assertEqual(result["image"], "img/paper.png")
        self.assertEqual(result["authors"], ["Alice Example"])
        self.assertEqual(result["links"]["video"], "https://example.org/video")
        self.assertEqual(result["links"]["pdf"], "/paper.pdf")
        self.assertEqual(result["category"], "Journal")
        self.run_sync()
        self.assertEqual(self.site(), site)

    def test_doi_update_can_move_year_without_duplicate(self):
        old = self.paper(year=2025, title="Old title", doi="10.1234/CasePaper")
        site_paper = {key: value for key, value in old.items() if key != "doi"}
        site_paper["links"] = {"doi": "https://dx.doi.org/10.1234/CasePaper"}
        self.write(self.data / "approved-publications.json", {"items": [old]})
        self.write(self.site_data / "publications.json", [{"year": 2025, "papers": [site_paper]}])
        self.approve_papers([self.paper(year=2026, title="Corrected title", doi="https://doi.org/10.1234/%43asePaper")])
        self.assertEqual(len(self.approved()), 1)
        site = self.site()
        self.assertEqual(sum(len(year["papers"]) for year in site), 1)
        self.assertEqual(site[0]["year"], 2026)
        self.assertEqual(site[0]["papers"][0]["title"], "Corrected title")
        self.assertEqual(site[0]["papers"][0]["links"]["doi"], "https://doi.org/10.1234/casepaper")

    def test_distinct_dois_are_not_collapsed(self):
        old = self.paper(title="Same title", doi="10.1234/one")
        self.write(self.data / "approved-publications.json", {"items": [old]})
        self.write(self.site_data / "publications.json", [{"year": 2026, "papers": [old]}])
        self.approve_papers([self.paper(title="Same title", doi="10.1234/two")])
        self.assertEqual(len(self.approved()), 2)
        self.assertEqual(len(self.site()[0]["papers"]), 2)

    def test_enrichment_batch_without_ids_keeps_new_records(self):
        old = self.paper(id="old", title="Old study")
        self.write(self.data / "approved-publications.json", {"items": [old]})
        self.write(self.site_data / "publications.json", [{"year": 2026, "papers": [old]}])
        incoming = [self.paper(title="New study one"), self.paper(title="New study two")]
        for item in incoming:
            del item["id"]
        self.approve_papers(incoming, {"mergeApprovedPublications": True})
        expected = {"Old study", "New study one", "New study two"}
        self.assertEqual({item["title"] for item in self.approved()}, expected)
        self.assertEqual({item["title"] for item in self.site()[0]["papers"]}, expected)
        self.assertEqual(len(self.approved()), 3)
        self.assertEqual(len(self.site()[0]["papers"]), 3)

    def test_sync_partial_and_invalid_approved_history_retains_site(self):
        old = [self.paper(title=f"Existing research {i}") for i in range(14)]
        old[0].update({"image": "img/paper.png", "links": {"pdf": "/paper.pdf"}, "custom": "keep"})
        self.write(self.site_data / "publications.json", [{"year": 2026, "papers": copy.deepcopy(old)}])
        self.write(self.data / "approved-publications.json", {"items": [
            self.paper(title="New research"), {"year": 2026, "title": ""}, {"year": "invalid", "title": "Bad year"},
        ]})
        self.run_sync()
        site = self.site()
        self.assertEqual(len(site[0]["papers"]), 15)
        self.assertEqual(site[0]["papers"][0], old[0])
        self.run_sync()
        self.assertEqual(self.site(), site)
        self.write(self.data / "approved-publications.json", {"items": []})
        self.run_sync()
        self.assertEqual(self.site(), site)

    def test_approval_rejects_past_member_and_unconfirmed(self):
        before_approved = self.read(self.data / "approved-publications.json")
        before_site = self.site()
        payload = {
            "reviewerName": "Test Reviewer", "reviewDate": "2026-11-23", "confirmed": True,
            "news": [], "publications": [self.paper(authorLine="A Person")],
        }
        with patch.object(update, "sync_and_build_site") as sync:
            ok, _ = update.approve(self.data, self.people, copy.deepcopy(payload))
            self.assertFalse(ok)
            payload["confirmed"] = False
            payload["publications"] = [self.paper()]
            ok, _ = update.approve(self.data, self.people, payload)
            self.assertFalse(ok)
            sync.assert_not_called()
        self.assertEqual(self.read(self.data / "approved-publications.json"), before_approved)
        self.assertEqual(self.site(), before_site)


if __name__ == "__main__":
    unittest.main()
