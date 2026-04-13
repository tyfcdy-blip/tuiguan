# OpenCLI Wanxiangtai Plugin

This plugin provides a first-pass `wanxiangtai keyword-report` command for keyword promotion plans.

## Command

```bash
opencli wanxiangtai keyword-report --item-id 1040300080126 --date 2026-04-13 -f json
```

## Data flow

1. Open Wanxiangtai keyword campaign page in a logged-in browser session.
2. Call `campaign/horizontal/findPage.json` to fetch campaign rows for an item ID.
3. Extract campaign IDs and adzone package IDs from the row payloads.
4. Call `report/query.json` to fetch the summary row.
5. Return campaign rows plus one appended summary row.

## Current field mapping

- `budget` <- `dayBudget`
- `charge` <- `reportInfoList[0].charge`
- `roi` <- `reportInfoList[0].roi`
- `ecpc` <- `reportInfoList[0].ecpc`
- `ctr` <- `reportInfoList[0].ctr`
- `cvr` <- `reportInfoList[0].cvr`
- `cartRate` <- `reportInfoList[0].cartRate`
- `cartCost` <- computed as `charge / (cartInshopNum + cartDirNum + cartIndirNum)`
- `totalDealCost` <- computed as `charge / (alipayInshopNum + alipayDirNum + alipayIndirNum)`

## Notes

- `findPage.json` currently carries both plan metadata and part of the realtime metrics.
- `report/query.json` is used here as the bottom summary row source.
- If token discovery fails, inspect page globals/localStorage and adjust `readRuntimeTokens`.
