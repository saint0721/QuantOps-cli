# Quant CLI Lab

CLI-first quant learning tools around `tossctl` read-only data.

## Commands

```bash
python3 -m quant_cli_lab doctor
python3 -m quant_cli_lab quote fetch AAPL
python3 -m quant_cli_lab quote history AAPL
python3 -m quant_cli_lab classify AAPL
python3 -m quant_cli_lab portfolio snapshot
python3 -m quant_cli_lab order preview --symbol AAPL --side buy --qty 1 --price 100
```

Safety defaults:
- no web UI
- no sensitive credential/session/account identifier storage in project data
- no order mutation command in V1
- order preview only
