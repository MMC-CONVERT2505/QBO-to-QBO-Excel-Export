# Changes - Account mapping, Item category, Customer fields, Open Balance, Invoice/Bill date filters

| Area | Change |
|---|---|
| Account (ZA) | Account type -> ZA type name; Detail type looked up from `server/src/mappings/ZA/accountTypeDetail.json`, generated from `source/account_mapping.xlsx` by `node scripts/buildAccountTypeMap.js`. No match -> source value kept, row flagged, listed under `unmappedValues`. |
| Item (ZA) | Category resolved from ParentRef chain (no extra API calls). A `Category` column was APPENDED to `templates/ZA/Item.xlsx` (the template had none). |
| Customer (ZA) | All 35 template columns mapped (was 15). Terms / Payment Method names resolved via Term + PaymentMethod lists (2 extra queries per export). Currency no longer defaults to "USD" in the normalizer. |
| Open Balance | TrialBalance uses start_date/end_date/accounting_method (not report_date). Row parser no longer requires `type:"Data"`. Per-stage diagnostic logging. Read-only diagnostics endpoint: `GET /api/qbo/diagnostics/open-balance?asOfDate=YYYY-MM-DD`. |
| Invoice / Bill | Optional Start/End Date (TxnDate, inclusive) - UI controls, 400 on invalid dates or start > end, QBO query `where TxnDate >= '..' and TxnDate <= '..'`. |
| Tests | `npm test` (server/) - 15 mocked-QBO regression tests. |

## Parent Item missing from Item export
- Cause: ZA Item template/mapping had no Parent Item column; ParentRef.name is often absent from the QBO response (only id); inactive parents are not returned by default queries; category logic only considered Category-type ancestors.
- Fix: `resolveItemRelations` resolves ParentRef by id (active items, then one `Active = false` lookup if needed) into `parentItemName` (immediate parent FullyQualifiedName) and `categoryName` (Category-type ancestors only). Added `Parent Item` + `Category` columns to ZA Item template/mapping. AU `Parent Ref Name` now populated.
- New read-only diagnostic: GET /api/qbo/diagnostics/items (counts only).
- Tests: 4 new (19 total) - mocked only; NOT verified against the live company.

## Parent row in Items export (Consultation / Consultation:Consultation)
- Cause: `filterExportableItems` (flatten.service.js) dropped every Category-type Item, so QBO parents such as "Consultation" never reached the sheet.
- Fix: Category items that are a direct/indirect parent of an exported item are kept (once) and emitted directly above their children. Childless categories still excluded.

## ZA Item Type + account names, console JSON
- ZA `item.json`: Type `Category` -> `Service` (valueMap); Income/Expense/Inventory asset account now use full Account Name (`Fee Income:Litigation`).
- `normalize.service.js`: `resolveItemAccounts` (by account id; unique-name fallback; ambiguous/unmatched kept + warning); `fetch.service.js` runs it against the shared normalized account list (inactive accounts looked up once if needed).
- New `src/utils/debugJson.js`: DEBUG_JSON=all|raw,normalized,mapped, DEBUG_JSON_LIMIT, DEBUG_JSON_MODULES. Hooks: qboClient.queryAll (raw), fetch.service fetchEntity (normalized), mapping.service mapCollection (mapped).

## Invoice (Detailed Transactions): tax code mapping + DEBUG_INVOICE_JSON
- Cause: SalesItemLineDetail.TaxCodeRef carries only the TaxCode Id (no name); normalizer used refName() || "Out of Scope", so every line became "Out of Scope". TaxCode entity was never fetched.
- Fix: fetchInvoiceDetail reads `select * from TaxCode` (+ one inactive lookup if needed) and resolveLineTaxCode() maps Id -> TaxCode.Name per line. No ref at all -> template default "Out of Scope"; unknown id -> raw id kept + warning.
- New src/utils/debugInvoice.js: DEBUG_INVOICE_JSON=true (+ DEBUG_INVOICE_IDS) prints full raw / normalized / mapped invoice JSON (sensitive; secrets redacted). Off by default.
- billDetail has the same pattern and was NOT changed (out of scope).

## Invoice tax rules (ZA): S + amount>0 -> Standard, amount 0 -> Out of Scope
- normalize.service.js: `applyInvoiceTaxRules` / `parseLineAmount` / `INVOICE_TAX_RULES`; per line, adds `exportTaxCodeName` + `taxRule` (source `taxCodeName` untouched). S is identified from the real TaxCode name, never from the amount. Negative / missing / non-numeric amounts keep the source code.
- ZA invoiceDetail.json: Tax Code column now reads `exportTaxCodeName`.
- diagnostics: /diagnostics/invoice-tax-codes now shows linesByAmount + exportedWhenPositive/Zero per code.

## Invoice: per-line Tax Amount
- Cause: Tax Amount was hard-coded 0 (QBO has no per-line tax; only TxnTaxDetail.TaxLine[] totals per rate).
- Fix: `allocateInvoiceTaxAmounts` (normalize.service.js) allocates each rate's TaxLine.Amount over the lines whose TaxCode (SalesTaxRateList) uses that rate, proportional to line amount, whole cents, remainder on the largest line -> lines sum exactly to QBO's tax. Unlinkable tax is not guessed (lines stay 0 + warning). fetch.service.js stores TaxCode.salesRateIds and logs `Invoice tax amounts: ...`.
- Diagnostics: taxRatesOnInvoices / salesTaxRateIds in /diagnostics/invoice-tax-codes.

## NEW MODULE: Invoice Credit Note (Detailed Transactions) - ZA only
- entities.js `creditMemoDetail` (QBO CreditMemo, date-range filter, depends on customer+item); fetch.service.js `fetchCreditMemoDetail` + shared `loadTaxCodesForDocs` (invoice detail refactored onto it, no behaviour change).
- normalize.service.js `normalizeCreditMemoDetailRecords` + `applyCreditNoteTaxRule`: per-line VAT amount (QBO TxnTaxDetail allocated, same as invoice) <> 0 -> "Standard", = 0 -> "Out of Scope"; if the VAT can't be linked to lines the source tax code is kept (never a false "Out of Scope").
- flatten.service.js: blank number -> transaction id; duplicate numbers -> number-txnId; 21-char limit (same rule as Invoice).
- templates/ZA/CreditMemoDetail.xlsx (sheet "Credit Note", column order from the team's field-mapping sheet) + mappings/ZA/creditMemoDetail.json. Only ZA has them -> other regions do not offer the module.
- Frontend: module + optional date range in ExportFlow.jsx / display.js.

## Credit note: TotalTax without TaxLine[] no longer reads as "no VAT"
- allocateInvoiceTaxAmounts: a document with TxnTaxDetail.TotalTax <> 0 but nothing allocatable is reported as unlinked (source tax code kept + warning), not Out of Scope.
- /diagnostics/invoice-tax-codes?entity=CreditMemo + taxDetail summary (documentsWithTotalTax / ...ButNoTaxLines).

## NEW MODULE: Invoice Payment (ZA)
- Template = team's "QBo (New)" sheet (inv_pyt.xlsx): Ref No, Customer, Payment Date, Payment method, Memo, Deposit To Account Name, Invoice No, Amount, Currency Code, Exchange Rate -> templates/ZA/InvoicePayment.xlsx (sheet "Invoice Payment", built from scratch with the same header style) + mappings/ZA/invoicePayment.json.
- entities.js `invoicePayment` (QBO Payment, date range, depends on customer+account); fetch.service.js `fetchInvoicePayments`; normalize.service.js `normalizeInvoicePaymentRecords`: one row per Payment.Line with a single Invoice LinkedTxn; credit-memo / multi-link lines are skipped + warned.
- Ref No: PaymentRefNum; blank -> payment transaction id; duplicate refs -> ref-transactionId (flatten.service.js).
- Invoice No: same number the Invoice (Detailed) sheet writes (`buildInvoiceNumberMap`).
- Deposit To Account: full account name from the Accounts list; no deposit account on the payment -> the Undeposited Funds account (found by AccountSubType).
- Frontend: module + optional date range.

## Journal Entry module (ZA only)
- New module `journal` (QBO `JournalEntry`), one Excel row per journal line, "QBo (New)" layout: Journal No *, Journal Date *, Memo, Account *, Amount *, Description, Name, Tax Code, Class, Currency Code, Exchange Rate.
- Amount = Debit - Credit (credit lines negative). Journal No: blank -> transaction id, duplicates -> `number-txnId`.
- Account/Class resolved to full names; optional date range (TxnDate).
- Files: `config/entities.js`, `services/fetch.service.js` (`fetchJournals`), `services/normalize.service.js` (`normalizeJournalRecords`), `services/flatten.service.js`, `services/template.service.js`, `utils/dateRange.js`, `mappings/ZA/journal.json`, `templates/ZA/Journal.xlsx`, frontend `ExportFlow.jsx` + `display.js`, 5 new tests (50 total).
- OPEN: "Journal type / cheque classification" is not in the team's sheet - no rule was invented (see chat).
- Verified with mock data only, not against live QBO.

## Overpayment module (ZA only) + transaction-number hardening
- New module `overpayment` (QBO Payment, `UnappliedAmt > 0`, Amount = unapplied amount), separate from Invoice Payment. Optional "Conversion Period" = payment date range. Template `templates/ZA/Overpayment.xlsx`, mapping `mappings/ZA/overpayment.json` (built from the Invoice Payment columns minus Invoice No - ASSUMPTION, real template not available).
- Invoice Payment: log now shows `paymentMethodSource`; inactive payment methods are looked up.
- `assignTransactionNumbers`: case/space-insensitive duplicate detection and no post-truncation collisions.
- Mock-tested only (53 tests), not verified against live QBO.

## Expense module (ZA only)
- New module `expense` (QBO Purchase: credit card / cheque / cash), one row per account-based expense line, "QBo (New)" Expense layout (16 columns, `templates/ZA/Expense.xlsx`, `mappings/ZA/expense.json`).
- Tax rule: line tax amount present -> "Standard"; zero -> "Out of Scope"; VAT that cannot be linked to a line keeps the source code and warns. Tax amount allocated from TxnTaxDetail using the TaxCode's PURCHASE rate list. Global Tax Calculation always "TaxExcluded".
- Ref No: blank -> transaction id, duplicates -> number-txnId. Item-based expense lines are skipped and logged (no Expense Account).
- `expenseType` (Credit Card / Cheque / Cash, from Purchase.PaymentType) is on each normalized row and in the log, but the team's template has no column for it.
- Mock-tested only (55 tests).

## Transfer module (ZA only)
- New module `transfer` (QBO Transfer), one row per transfer, "QBo (New)" layout: Transfer Funds From *, Transfer Funds To *, Transfer Amount *, Date *, Privatenote, Currency Code, Exchange Rate, Ref no. (`templates/ZA/Transfer.xlsx`, `mappings/ZA/transfer.json`). Ref no = the transfer's QBO transaction id. Optional date range.
- OPEN: "transfer type / cheque classification" is not a column in the team's sheet - nothing invented.
- Mock-tested only (56 tests).

## Deposit module (ZA only)
- New module `deposit` (QBO Deposit), one row per deposit line, "QBo (New)" Deposit layout (16 columns, `templates/ZA/Deposit.xlsx`, `mappings/ZA/deposit.json`).
- Deposit No: blank -> transaction id, duplicates -> number-txnId. Global Tax Calculation always TaxExcluded. Tax rule: line tax amount present -> Standard, zero -> Out of Scope; unlinkable VAT keeps source code + warns. Line tax allocation uses the TaxCode SALES rate list (assumption).
- Lines that only link a payment (no AccountRef) use the Undeposited Funds account (QBO behaviour). Linked Transaction Type = DepositLineDetail.TxnType, else LinkedTxn type. Location = DepartmentRef.
- OPEN: "deposit type / cheque classification" is not a template column - nothing invented (cheque number / payment method are available on lines).
- Mock-tested only (57 tests).

## Cheque module (ZA only) + Expense/Cheque split
- New module `cheque`: QBO Purchase with `PaymentType = Check`, "QBo (New)" Cheque layout (15 columns, `templates/ZA/Cheque.xlsx`, `mappings/ZA/cheque.json`). Cheque no: blank -> transaction id, duplicates -> number-txnId. Same tax rule as Expense (VAT amount -> Standard, zero -> Out of Scope), Global Tax Calculation TaxExcluded.
- CHANGED: the Expense module now takes only non-cheque purchases (credit card / cash), so a purchase is never exported by both sheets. Label: "Expense (Credit Card / Cash)".
- Mock-tested only (58 tests).

## Expense / Cheque / Deposit tax amount fix (reported: Tax Amount 0 with "Standard")
- Line tax allocation now accepts a TaxRate on EITHER the TaxCode's purchase or sales rate list (was: purchase list only for Expense/Cheque, sales list only for Deposit).
- `/api/qbo/diagnostics/invoice-tax-codes?entity=Purchase|Deposit` added (same read-only analysis as Invoice/CreditMemo).
- Mock-tested only (60 tests).

## Tax amount: link by percent when the TaxLine rate id is not in the TaxCode rate list
- Reported (ZA, Live): Deposit/Cheque/Expense tax stayed unlinked because the TaxLine rate ids (58/59) were not in the "Standard" code's rate lists (purchase 42 / sales 43).
- `fetchTaxCodeMap` now also reads the TaxRate list (read-only) and stores each code's rate percents; `allocateInvoiceTaxAmounts` falls back to matching by PERCENT (TaxLine.TaxPercent == a rate percent on the line's OWN tax code). Never from amounts alone; if no percent / no match the old "kept-tax-unlinked" behaviour remains. `taxAmountSource = txn-tax-line-by-percent`.
- Applies to every module that allocates tax (Invoice, Credit Note, Expense, Cheque, Deposit).
- Mock-tested only (62 tests).

- TaxRate lookup now reads ACTIVE and INACTIVE rates and logs `TaxRate list: active=… inactive=…; TaxCode rate ids with no TaxRate record=[…]`; diagnostics output gained `taxRatesInQbo`. (Live log showed `percents=[]` for the Standard code, i.e. rates 42/43 were not found in the active list.)

## Dynamic Tax Mapping (all regions, opt-in)
- New page `/tax-mapping` (sidebar "Tax Mapping"): source TaxCode/TaxRate (name, rate, type, components, inactive) read live from the connected SOURCE company; table Source Tax | Source Rate | Target Tax | Target Rate | Status | Action; filters All/Mapped/Suggested/Manual Rate/Unmapped/Error + search by name/percentage; "+ Enter Tax Rate Manually" form (Tax Name, Rate %, Type, Inclusive/Exclusive, "exists in target" confirmation) with client + server validation.
- Target company: the tool has NO target connection, so target taxes are entered by the user; a typed percentage is never treated as an existing target tax and unconfirmed entries are not used. The tool cannot create tax codes in the target.
- Suggestions: only "same name and rate" for single-component taxes with a known rate; never for multi-component / unknown-rate taxes.
- Saved per source company + region (`server/data/tax-mappings.json`, override `TAX_MAPPING_FILE`); applies to exports only when the region's "Use this tax mapping" switch is on. Regional hard rules (ZA VAT present -> Standard / zero -> Out of Scope; S->Standard) are final and never overridden.
- Lines whose source tax has no usable mapping are `invalid` in the preview (`unresolved_tax_mapping`) and not written to Excel; nothing is substituted.
- API: `GET/PUT /api/tax-mapping`. Files: `services/taxMapping.service.js`, `controllers/taxMapping.controller.js`, `routes/taxMapping.routes.js`, `server.js`, `flatten/validation/excel/mapping` services (optional ctx), `export/mapping` controllers, `exportJob.service.js`, frontend `pages/TaxMapping.jsx`, `App.jsx`, `Sidebar.jsx`.
- Limitation: Bill (Detailed) rows carry no source tax code today (always "Out of Scope"), so the mapping has nothing to apply there.
- Mock-tested only (68 tests).

## Tax amount: verified last-resort link (Deposit/Cheque/Expense/Invoice/Credit Note)
- Live log showed TaxLine rate ids (58/59) that are not in the TaxCode rate lists (42/43), with `percents=[]`. New last resort in `allocateInvoiceTaxAmounts`: when EXACTLY ONE non-zero tax line is still unlinked, it is shared across the lines whose own tax code is taxable and is not claimed by another tax line of the document (e.g. the 0% line owned by "Out of Scope"). Accepted ONLY if base x TaxLine.TaxPercent reproduces the tax amount (within rounding); otherwise it stays unlinked (`kept-tax-unlinked`). `taxAmountSource = txn-tax-line-verified-by-percent`.
- Tests that relied on "unlinkable" fixtures now use a non-verifying TaxPercent; new assertions for the verified, wrong-percent and two-unlinked-lines cases.
- Mock-tested only (68 tests).

## Deposit: "Tax Applicable On *" and "Tax Amount *" columns (ZA)
- templates/ZA/Deposit.xlsx: two new columns after "Line Tax Code".
- mappings/ZA/deposit.json: "Tax Applicable On *" (default "Sales", required) and "Tax Amount *" (taxAmount, default 0, required).
- normalize.service.js: deposit rows carry taxApplicableOn = "Sales".

## New module: Credit Card (ZA)
- Template `templates/ZA/CreditCard.xlsx` (sheet "CreditCard") and mapping `mappings/ZA/creditCard.json` follow the team's "Credit card charge (Expense)" QBo (New) layout (same 16 columns as Expense).
- Source: QBO Purchase with PaymentType = CreditCard, one row per account-based expense line.
- Rules: Ref No blank -> transaction id, duplicates -> number-txnId; Global Tax Calculation = TaxExcluded; VAT present -> Standard, zero -> Out of Scope; Tax Amount blank -> 0; Tax Code blank -> Out of Scope. Tax amount uses the same allocation as Expense/Cheque.
- No overlap between modules: Credit Card = CreditCard, Cheque = Check, Expense = Cash (label changed to "Expense (Cash)").
- Wiring: config/entities.js, template.service.js, dateRange.js, flatten.service.js, fetch.service.js (fetchExpenses kind "creditCard"), frontend ExportFlow.jsx and display.js (with date range).

## New module: Bill Overpayment (ZA)
- Template `templates/ZA/BillOverpayment.xlsx` and mapping `mappings/ZA/billOverpayment.json`: Ref No *, Payment Date *, Memo, Vendor *, Bank or CC Account *, Amount *, Currency Code, Exchange Rate (the team's Bill payment "QBo (New)" columns without "Bill No", because an overpayment is not applied to a bill).
- Source: QBO BillPayment. Amount = TotalAmt - (lines linked to a Bill - lines linked to a VendorCredit); only payments with an unapplied amount > 0 are exported. Optional payment date range = Conversion Period.
- Bank or CC Account: CheckPayment.BankAccountRef (PayType Check) / CreditCardPayment.CCAccountRef (PayType CreditCard), full account name from the Accounts list (inactive accounts looked up when needed).
- Ref No: blank -> transaction id, duplicates -> number-txnId.
- Wiring: config/entities.js, template.service.js, dateRange.js, flatten.service.js, normalize.service.js, fetch.service.js (log line `Bill overpayments:`), frontend ExportFlow.jsx / display.js.

## Payment method default (Invoice Payment and Overpayment)
- QBO allows payments without a Payment Method, but the template requires "Payment method *", so those rows were Invalid.
- New optional `.env` setting `DEFAULT_PAYMENT_METHOD` (empty by default = old behaviour). When set, it is written only where the QBO payment has no method; `paymentMethodSource` shows `configured-default` in the logs. The value must exist as a Payment Method in the destination QBO.

## Payment method no longer required (Invoice Payment, Overpayment)
- `mappings/ZA/invoicePayment.json` and `overpayment.json`: "Payment method *" is no longer `required`. The cell is filled when the QBO payment has a method (or `DEFAULT_PAYMENT_METHOD` is set) and left blank otherwise; such rows are no longer Invalid.

## Journal No format (team rule)
- Duplicate Journal numbers are now written as `<transaction id>_<reference number>` (e.g. `1573_253472`) - transaction id FIRST, underscore separator - so a length limit can never cut the transaction id. Blank numbers still become the transaction id; unique numbers are unchanged.
- Journal numbers are limited to 21 characters (QBO limit); when a number is too long only the reference part is cut.
- flatten.service.js: `assignTransactionNumbers` got `separator` and `transactionIdFirst` options (other modules keep `<number>-<txnId>`).

## Five new ZA modules (Estimates, Purchase Order, Other Journal Types, Bill / Invoice Credit Note Allocation)
All five exist only for ZA (template + mapping); each has an optional date range in the frontend. Templates/headers follow the team's "QBo (New)" sheets ("*" where the sheet says mandatory; only the truly essential columns are enforced as required).

- **Estimates** (`Estimate.xlsx`): QBO Estimate, one row per item line. Estimate No is ALWAYS `<transactionId>_<DocNumber>` (team: "concatenate TxnID and DocNumber always"; transaction id first, 21-char limit cuts only the DocNumber). Status, Accepted By/Date, Expiration Date, Message to customer, Discount %, Location, CustomFieldPONumber (custom field named like "P.O. Number"). Tax: VAT amount present -> Standard, zero -> Out of Scope; Tax Amount blank -> 0.
- **Purchase Order** (`PurchaseOrder.xlsx`): QBO PurchaseOrder, one row per line. Account-based lines fill the Expense columns, item-based lines the Product/Service columns (the other kind stays blank). PO No same always-concatenate rule. Terms from SalesTermRef when present.
- **Other Journal Types** (`OtherJournal.xlsx`, Journal layout): read from the QBO Journal report (no API entity exists), limited to Inventory Qty Adjust, Inventory Starting Value (from Desktop), Sales Tax Payment, Item Receipt (`OTHER_JOURNAL_TRANSACTION_TYPES` in config/entities.js). One journal per transaction: Journal No = `<date as number YYYYMMDD>_<Num>` (date number only when no Num), `_2`, `_3` for clashes, 21 chars. Amount = Debit - Credit. Log line `Other journal:` lists the report columns and every transaction type found.
- **Invoice Credit Note Allocation** (`InvoiceCreditAllocation.xlsx`): QBO Payments that link a CreditMemo or JournalEntry; one row per Line -> linked transaction. Invoice No / CreditNote NO / Journal No equal the numbers of the Invoice, Credit Note and Journal sheets; AppliedToTxnTxnType = Invoice / CreditMemo / JournalEntry.
- **Bill Credit Note Allocation** (`BillCreditAllocation.xlsx`): QBO BillPayments that link a VendorCredit; one row per Line -> linked Bill / VendorCredit (the team's example layout). Voucher No = Bill / Vendor Credit number; Txn Type = Bill / VendorCredit; TotalAmount = payment TotalAmt.
- Shared: `buildDocumentNumberMap` (flatten.service.js), `assignTransactionNumbers` unchanged for other modules.

## Bill (Detailed Transactions): Tax Code and Tax Amount
- Bill lines always showed "Out of Scope" / 0 because the Bill module never read the line TaxCodeRef or TxnTaxDetail (a documented limitation). It now resolves the line tax code from the TaxCode list and allocates TxnTaxDetail over the lines with the same engine as Expense / Purchase Order (rate id, percent, verified residual layers; purchase and sales rate lists).
- ZA rule: VAT amount present -> "Standard", zero -> "Out of Scope"; if a Bill's tax cannot be linked to its lines the source tax code is kept and a warning with `TxnTaxDetail.TaxLine=[...] lineTaxCodes=[...]` is logged.
- `mappings/ZA/billDetail.json`: Tax Code now reads `exportTaxCodeName`. Log line `Bill tax:` shows the rule / amount-source counts.

## Bill Payment and Bill Credit (Supplier Credit) - ZA only
- **Bill Payment** (`BillPayment.xlsx`, sheet BillPayment): QBO BillPayment, one row per Line -> linked Bill. Columns: Ref No *, Payment Date *, Memo, Vendor *, Bank or CC Account *, Amount *, Bill No *, Currency Code, Exchange Rate. Ref No: blank -> transaction id, duplicate -> `<number>-<transactionId>`. Bill No equals the number the Bill sheet exports. Bank / CC account = CheckPayment.BankAccountRef or CreditCardPayment.CCAccountRef (full account name). Lines linked to a VendorCredit are not exported here (see Bill Credit Note Allocation); they are logged as `line not exported`. Log line: `Bill payments:`.
- **Bill Credit (Supplier Credit)** (`SupplierCredit.xlsx`, sheet SupplierCredit): QBO VendorCredit, one row per line (account-based and item-based), same engine as Bill. Ref No rule as above (21-char safe via the shared helper). Global Tax Calculation always TaxExcluded. Tax Code: VAT amount present -> Standard, zero -> Out of Scope, blank -> Out of Scope; Taxable Amount (tax amount) blank -> 0; Qty blank -> 1; Rate = Amount / Qty. Log line: `Bill credit tax:`.
- Existing `ap_billcredit` (aging based) and `VendorCredit.xlsx` are untouched. Wired in entities, template service, date range, flatten, fetch, ExportFlow and display constants. 80 tests pass (mock data only).

## Invoice Payment: missing transactions, Transaction Type, Journal No
- New columns at the end of `InvoicePayment.xlsx`: **Journal No** and **Transaction Type** (Invoice / JournalEntry = the type of the linked transaction).
- A payment line made through a payment journal (LinkedTxn JournalEntry) is now exported: Invoice No blank, Journal No = the number the Journal sheet exports, Transaction Type = JournalEntry. Invoice No is required only for Invoice rows.
- A line that also carries a CreditMemo link beside its Invoice/Journal link is no longer dropped (the line Amount belongs to the Invoice/Journal link).
- Still reported, not exported: lines with only non-invoice links (e.g. CreditMemo only: see Invoice Credit Note Allocation) and lines with TWO OR MORE Invoice/Journal links (one Amount cannot be split). Warning `Payment <id>: line not exported (...)`. Log line `Invoice payments:` now shows `byTransactionType` and `journalNumberSource`.

## Bill and Bill Credit: Product & Service side, Customer Job, Memo
- **Bill (Detailed)** (`BillDetail.xlsx`) new columns at the end: Product & Service (Item), Product & Service Description, Product & Service Tax Code, Product & Service Tax Amount, Expense Customer Job, Product & Service Customer Job, Memo.
- **Bill Credit** (`SupplierCredit.xlsx`) new columns at the end: Line Item, Line Item Description, Line Item Tax Code, Line Item Tax Amount, Expense Customer Ref Name, Line Customer Ref Name, Memo.
- Item-based lines fill the Product & Service / Line Item columns (item name, description, tax code and tax amount with the same VAT rule: present -> Standard, zero -> Out of Scope); account-based lines leave them blank. Customer Job goes to the Expense column for account lines and to the Product & Service / Line column for item lines (full `Customer:Job` name; ref name first, else one Customer lookup, plus one for inactive). Memo = PrivateNote of the Bill / Vendor Credit.
- Existing columns are unchanged (item lines still also fill Account / Tax Code / Product/Service / Quantity / Rate as before). Logs `Bill tax:` / `Bill credit tax:` now show `customerJobLines` and `customerJobUnresolved`.

## Bill / Bill Credit line diagnostics (why are the new columns empty?)
- Every Bill and Bill Credit export logs one summary line `Bill lines:` / `VendorCredit lines:` (line counts by DetailType, lines with ItemRef / CustomerRef / ClassRef, memos, exported rows with item name / customer job). No names or amounts.
- `DEBUG_BILL_LINES=true` (optional `DEBUG_BILL_LINES_LIMIT`, default 5) prints the complete raw QBO JSON of the first documents that have an item line or a line CustomerRef, with the exported rows built from them. Off by default (real financial data).

## Allocation diagnostics (0 rows)
- `Bill credit note allocations diagnostics:` logs the LinkedTxn types found on all BillPayment lines and how the Vendor Credits look (own LinkedTxn types, number applied). `Invoice credit note allocations diagnostics:` logs the Payment line link types. Counts only; used to find out why an allocation export is empty.

## Team feedback round (Invoice Payment, Overpayment, Credit Note Allocation, Bill Payment)
- **Invoice Payment:** new column **Cheque Number** (the payment reference, only when the payment method is a cheque). A Journal link on the SAME payment line as the Invoice is the payment journal: its number is now carried in **Journal No** on the Invoice row (Transaction Type stays Invoice). Journal-only lines keep Transaction Type JournalEntry. New log `Invoice payments line link combinations:` (e.g. `Invoice+JournalEntry: n`) shows which shapes the source has.
- **Overpayment:** payments allocated through a journal / credit memo are no longer reported as overpayments (unapplied = min(UnappliedAmt, TotalAmt - all linked lines)); skipped count logged. **Bill Overpayment:** lines paid through a journal count as applied.
- **Invoice Credit Note Allocation:** `CreditNote NO` no longer carries the "CN-" prefix (13074, not CN-13074). Prefix is `CREDIT_NOTE_NUMBER_STRIP_PREFIX` (default `CN-`, set empty to disable). Only this sheet is changed; the Invoice Credit Note sheet is unchanged.
- **Bill Payment:** new columns **Journal No** and **Transaction Type** (Bill / JournalEntry). Journal-paid lines are exported; Bill No is required only for Bill rows. New log `Bill payments line link combinations:` (also lines without link / payments without lines) to find any transaction that is still missing.

## Invoice Credit Note Allocation layout + journal link tolerance
- **InvoiceCreditAllocation.xlsx** columns now: Transaction No., TxnDate, CustomerRef Name, Deposit To Account Ref, Private Note, CurrencyRef Value, ExchangeRate, **TotalAmount** (payment TotalAmt), Line Amount*, **Voucher No**, AppliedToTxnTxnType. The three separate Invoice No / Journal No / CreditNote NO columns are replaced by ONE "Voucher No" (number of the linked Invoice, Journal or Credit Note; "CN-" prefix still removed from credit notes). Same layout idea as Bill Credit Note Allocation.
- A linked-transaction type containing "journal" (JournalEntry / Journal Entry / Journal) is treated as a journal everywhere (Invoice Payment, allocation, Overpayment, Bill Payment). The Transaction Type column shows the type exactly as QBO sends it.
- `DEBUG_PAYMENT_LINKS=true` (optional `DEBUG_PAYMENT_LINKS_LIMIT`, default 5): prints the complete raw JSON of the first Payments whose lines link something other than an Invoice. Log `Invoice payments skipped lines by reason/type:` summarizes skipped lines.

## Bill Payment journal diagnostics
- `DEBUG_PAYMENT_LINKS=true` now also prints the raw JSON of the first BillPayments that link something other than a Bill; log `Bill payments skipped lines by reason/type:` summarizes skipped lines.

## Exchange Rate default
- Bill Payment, Bill Credit Note Allocation and Invoice Credit Note Allocation: when the payment has a Currency but QBO sends no ExchangeRate (home-currency payments), Exchange Rate is now 1 (same as Invoice Payment / Bill Overpayment). Still blank when there is no Currency.

## Export page: ONE transaction date range
- The per-module date range blocks are gone. The Export page now has exactly two date filters: the Open Balance **conversion cutoff / as-of date** (unchanged, only for AR/AP/Open Balance) and ONE **Transaction date range** (Start / End, both optional, either end may be left open) that applies to every selected transaction module (invoices, bills, payments, credit notes, allocations, overpayments, deposits, transfers, expenses, cheques, credit cards, estimates, purchase orders, journals, other journals).
- Frontend only (`ExportFlow.jsx`): the single range is sent as the same `dateRanges` entry for every selected transaction module, so the API and the backend date filters are unchanged. Start after End blocks the preview. Checked with an esbuild syntax pass only; run `npm run build` / the dev server to see it.

## 2026-11-04 - Frontend UI/UX redesign (frontend only)
- tailwind.config.js / index.css: new design tokens (navy #142B4A, teal #0F8B8D, slate text, borders #E2E8F0); same class names kept; reduced-motion support; draw-check animation.
- components: ui.jsx (+PageHeader, StatTile, ProgressBar, SearchInput, Modal, ConfirmDialog, SuccessMark, Checkbox), collapsible Sidebar (state in localStorage), Header (company chip + status on every page), WizardSteps, Stepper, RegionCard, ModuleCard.
- pages: Dashboard, ExportFlow (grouped modules, Select all/Deselect all, search, sticky action bar, review summary, progress %, success screen), TaxMapping (summary tiles, highlighted unmapped rows, animated modal), Connect (confirm-disconnect dialog, OAuth steps).
- Unchanged: backend, OAuth, API calls/payloads, mapping/validation/Excel logic, routes. Landing.jsx only inherits new tokens.
