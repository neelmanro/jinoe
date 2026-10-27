from __future__ import annotations

from task_workflow import _changed_files_from_numstat


def test_changed_files_include_statuses_line_counts_and_binary_files() -> None:
    numstat = "\n".join(
        [
            "2\t1\tsrc/app.ts",
            "1\t0\tsrc/new.ts",
            "0\t3\tsrc/old.ts",
            "-\t-\tassets/logo.png",
        ]
    )
    name_status = "\n".join(
        [
            "M\tsrc/app.ts",
            "A\tsrc/new.ts",
            "D\tsrc/old.ts",
            "M\tassets/logo.png",
        ]
    )

    assert _changed_files_from_numstat(numstat, name_status) == [
        {"path": "src/app.ts", "status": "M", "additions": 2, "deletions": 1},
        {"path": "src/new.ts", "status": "A", "additions": 1, "deletions": 0},
        {"path": "src/old.ts", "status": "D", "additions": 0, "deletions": 3},
        {"path": "assets/logo.png", "status": "M", "additions": 0, "deletions": 0},
    ]


def test_changed_files_use_destination_paths_for_renames() -> None:
    numstat = "\n".join(
        [
            "1\t0\tsrc/{old => new}/file.ts",
            "0\t0\told.py => new.py",
            "0\t0\t{old dir => new dir}/file.txt",
        ]
    )
    name_status = "\n".join(
        [
            "R075\tsrc/old/file.ts\tsrc/new/file.ts",
            "R100\told.py\tnew.py",
            "R100\told dir/file.txt\tnew dir/file.txt",
        ]
    )

    assert _changed_files_from_numstat(numstat, name_status) == [
        {"path": "src/new/file.ts", "status": "R075", "additions": 1, "deletions": 0},
        {"path": "new.py", "status": "R100", "additions": 0, "deletions": 0},
        {"path": "new dir/file.txt", "status": "R100", "additions": 0, "deletions": 0},
    ]


def test_changed_files_skip_malformed_numstat_lines_and_default_unknown_status_to_modified() -> None:
    numstat = "\n".join(
        [
            "this is not numstat",
            "3\t2\tsrc/without-name-status.ts",
        ]
    )

    assert _changed_files_from_numstat(numstat, "") == [
        {"path": "src/without-name-status.ts", "status": "M", "additions": 3, "deletions": 2},
    ]
