"""Lanceur utilisé par PyInstaller (évite les imports relatifs de epp/__main__.py)."""
import sys

from epp.app import main

if __name__ == "__main__":
    sys.exit(main())
