#!/usr/bin/env python3
import pandas as pd
import json
from pathlib import Path
from datetime import datetime

DATA_FILE = Path("data/ACTIVACION DE CLIENTES .xlsx")
OUTPUT_DIR = Path("portal")
OUTPUT_FILE = OUTPUT_DIR / "data.json"

def procesar_datos():
    try:
        clientes = pd.read_excel(DATA_FILE, sheet_name="CLIENTES")
        facturas = pd.read_excel(DATA_FILE, sheet_name="FACTURACION")
        
        clientes.columns = [c.strip().upper() for c in clientes.columns]
        facturas.columns = [c.strip().upper() for c in facturas.columns]
        
        payload = {
            "generated_at": datetime.now().isoformat(),
            "clientes": clientes.fillna("").to_dict("records"),
            "facturas": facturas.fillna("").to_dict("records"),
            "stats": {
                "total_clientes": len(clientes),
                "total_facturas": len(facturas),
            }
        }
        
        OUTPUT_DIR.mkdir(exist_ok=True)
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        
        print(f"✓ Datos procesados")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        raise

if __name__ == "__main__":
    procesar_datos()