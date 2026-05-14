"""Build PLAYBOOK.docx from PLAYBOOK.md with Joe-specified styling.

Steps:
1. Take pandoc's default reference docx (reference.docx in repo root).
2. Rewrite the relevant styles in word/styles.xml — fonts to Georgia,
   sizes to 12/14/16 pt, tight paragraph spacing.
3. Patch word/document.xml's sectPr to 1" margins all around.
4. Save as reference_custom.docx, then invoke pandoc to produce
   PLAYBOOK.docx using it.

Re-runnable; safe to re-run if you tweak PLAYBOOK.md.

Local-only tool — kept out of git via .gitignore alongside PLAYBOOK.md.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

REPO = Path(__file__).resolve().parent.parent
REFERENCE_SRC = REPO / "reference.docx"
REFERENCE_CUSTOM = REPO / "reference_custom.docx"
PLAYBOOK_MD = REPO / "PLAYBOOK.md"
PLAYBOOK_DOCX = REPO / "PLAYBOOK.docx"
PANDOC = Path.home() / "AppData" / "Local" / "Pandoc" / "pandoc.exe"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", W_NS)
W = f"{{{W_NS}}}"

# Paragraph-style targets. Sizes are in half-points (so 24 = 12pt).
# Spacing is in twips (1/20 pt); 1440 twips = 1 inch.
STYLE_OVERRIDES: dict[str, dict] = {
    "Normal": {
        "font": "Georgia",
        "size": 24,           # 12 pt
        "bold": False,
        "before": 0,
        "after": 80,          # 4 pt
        "line": 276,          # 1.15 line spacing
    },
    "Heading1": {
        "font": "Georgia",
        "size": 32,           # 16 pt
        "bold": True,
        "before": 240,        # 12 pt
        "after": 80,          # 4 pt
        "line": 276,
    },
    "Heading2": {
        "font": "Georgia",
        "size": 28,           # 14 pt
        "bold": True,
        "before": 200,        # 10 pt
        "after": 60,          # 3 pt
        "line": 276,
    },
    "Heading3": {
        "font": "Georgia",
        "size": 24,           # 12 pt
        "bold": True,
        "before": 160,        # 8 pt
        "after": 40,          # 2 pt
        "line": 276,
    },
    "Heading4": {
        "font": "Georgia",
        "size": 24,
        "bold": True,
        "before": 120,
        "after": 40,
        "line": 276,
    },
    "FirstParagraph": {
        "font": "Georgia", "size": 24, "bold": False,
        "before": 0, "after": 80, "line": 276,
    },
    "BodyText": {
        "font": "Georgia", "size": 24, "bold": False,
        "before": 0, "after": 80, "line": 276,
    },
    "Compact": {
        "font": "Georgia", "size": 24, "bold": False,
        "before": 0, "after": 40, "line": 276,
    },
    "BlockText": {  # blockquote
        "font": "Georgia", "size": 24, "bold": False,
        "before": 80, "after": 80, "line": 276,
    },
    "ListParagraph": {
        "font": "Georgia", "size": 24, "bold": False,
        "before": 0, "after": 40, "line": 276,
    },
}


def _ensure_child(parent: ET.Element, tag: str) -> ET.Element:
    """Return the first child with `tag`, creating it if absent."""
    child = parent.find(tag)
    if child is None:
        child = ET.SubElement(parent, tag)
    return child


def _set_style(style_el: ET.Element, spec: dict) -> None:
    """Overwrite the pPr/rPr of a paragraph style with the spec values."""
    # rPr (run properties): font + size + bold
    rpr = _ensure_child(style_el, f"{W}rPr")
    rfonts = _ensure_child(rpr, f"{W}rFonts")
    # Explicit font wins only if the theme font references aren't set;
    # otherwise Word's theme resolution picks majorHAnsi/minorHAnsi
    # (typically Calibri / Calibri Light) and the explicit name is
    # ignored. Strip every theme-ref attribute, then set the explicit
    # font on every ascii/hAnsi/cs/eastAsia slot.
    for theme_attr in (
        "asciiTheme", "hAnsiTheme", "cstheme", "eastAsiaTheme",
    ):
        if rfonts.get(f"{W}{theme_attr}") is not None:
            del rfonts.attrib[f"{W}{theme_attr}"]
    for attr in ("ascii", "hAnsi", "cs", "eastAsia"):
        rfonts.set(f"{W}{attr}", spec["font"])
    sz = _ensure_child(rpr, f"{W}sz")
    sz.set(f"{W}val", str(spec["size"]))
    sz_cs = _ensure_child(rpr, f"{W}szCs")
    sz_cs.set(f"{W}val", str(spec["size"]))
    # Strip the theme-driven accent color the default reference applies
    # to headings — we want plain-black Georgia, not a blue accent.
    for color_el in rpr.findall(f"{W}color"):
        rpr.remove(color_el)
    # bold
    existing_b = rpr.find(f"{W}b")
    if spec["bold"]:
        if existing_b is None:
            ET.SubElement(rpr, f"{W}b")
    else:
        if existing_b is not None:
            rpr.remove(existing_b)

    # pPr (paragraph properties): spacing
    ppr = _ensure_child(style_el, f"{W}pPr")
    spacing = _ensure_child(ppr, f"{W}spacing")
    spacing.set(f"{W}before", str(spec["before"]))
    spacing.set(f"{W}after", str(spec["after"]))
    spacing.set(f"{W}line", str(spec["line"]))
    spacing.set(f"{W}lineRule", "auto")
    # Strip auto-spacing flags that would override our explicit numbers.
    for attr in ("beforeAutospacing", "afterAutospacing"):
        if spacing.get(f"{W}{attr}") is not None:
            del spacing.attrib[f"{W}{attr}"]


def patch_styles_xml(xml_bytes: bytes) -> bytes:
    tree = ET.ElementTree(ET.fromstring(xml_bytes))
    root = tree.getroot()
    # Index existing styles by w:styleId.
    by_id: dict[str, ET.Element] = {}
    for s in root.findall(f"{W}style"):
        style_id = s.get(f"{W}styleId")
        if style_id:
            by_id[style_id] = s

    for style_id, spec in STYLE_OVERRIDES.items():
        if style_id not in by_id:
            # If the default reference doc didn't define one of these
            # (unusual), skip — pandoc will fall through to Normal.
            continue
        _set_style(by_id[style_id], spec)

    # Also force the document defaults (rPrDefault) to Georgia 12 so
    # text in styles we didn't touch still inherits the right look.
    doc_defaults = root.find(f"{W}docDefaults")
    if doc_defaults is None:
        doc_defaults = ET.Element(f"{W}docDefaults")
        root.insert(0, doc_defaults)
    rpr_default = _ensure_child(doc_defaults, f"{W}rPrDefault")
    rpr_inner = _ensure_child(rpr_default, f"{W}rPr")
    rfonts_def = _ensure_child(rpr_inner, f"{W}rFonts")
    for attr in ("ascii", "hAnsi", "cs", "eastAsia"):
        rfonts_def.set(f"{W}{attr}", "Georgia")
    sz_def = _ensure_child(rpr_inner, f"{W}sz")
    sz_def.set(f"{W}val", "24")

    body = ET.tostring(root, encoding="UTF-8")
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body


def patch_document_xml(xml_bytes: bytes) -> bytes:
    """Set page margins to 1 inch (1440 twips) on all sides."""
    tree = ET.ElementTree(ET.fromstring(xml_bytes))
    root = tree.getroot()
    body = root.find(f"{W}body")
    if body is None:
        return xml_bytes
    sect_pr = body.find(f"{W}sectPr")
    if sect_pr is None:
        sect_pr = ET.SubElement(body, f"{W}sectPr")
    pg_mar = sect_pr.find(f"{W}pgMar")
    if pg_mar is None:
        pg_mar = ET.SubElement(sect_pr, f"{W}pgMar")
    for attr in ("top", "right", "bottom", "left"):
        pg_mar.set(f"{W}{attr}", "1440")
    # Keep header/footer/gutter at modest defaults if not already set.
    for attr, default in (("header", "720"), ("footer", "720"), ("gutter", "0")):
        if pg_mar.get(f"{W}{attr}") is None:
            pg_mar.set(f"{W}{attr}", default)
    body = ET.tostring(root, encoding="UTF-8")
    return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body


def build_custom_reference(src: Path, dst: Path) -> None:
    """Copy reference.docx → reference_custom.docx with patched XML."""
    if dst.exists():
        dst.unlink()
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(
        dst, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/styles.xml":
                data = patch_styles_xml(data)
            elif item.filename == "word/document.xml":
                data = patch_document_xml(data)
            zout.writestr(item, data)


def run_pandoc() -> None:
    if not PANDOC.exists():
        sys.exit(f"pandoc not found at {PANDOC}")
    cmd = [
        str(PANDOC),
        str(PLAYBOOK_MD),
        "-o",
        str(PLAYBOOK_DOCX),
        f"--reference-doc={REFERENCE_CUSTOM}",
        "--from=gfm",
    ]
    print("running:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    if not REFERENCE_SRC.exists():
        sys.exit(
            f"missing {REFERENCE_SRC}; generate with:\n"
            f"  pandoc -o reference.docx --print-default-data-file reference.docx > reference.docx"
        )
    if not PLAYBOOK_MD.exists():
        sys.exit(f"missing {PLAYBOOK_MD}")
    print(f"Patching {REFERENCE_SRC.name} -> {REFERENCE_CUSTOM.name}")
    build_custom_reference(REFERENCE_SRC, REFERENCE_CUSTOM)
    print(f"Built reference. Running pandoc.")
    run_pandoc()
    print(f"Wrote {PLAYBOOK_DOCX.relative_to(REPO)}")


if __name__ == "__main__":
    main()
