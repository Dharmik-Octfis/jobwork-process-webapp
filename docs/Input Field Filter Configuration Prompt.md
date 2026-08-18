# Input Field Filter Configuration

Implement a **dynamic filter system** for all input field types available in the application.

The filter options must be displayed based on the selected field's **input type**. Each input type should have only the relevant and supported operators.

## 1. Text / Short Text

**Applicable Filters:**

- Is
- Is Not
- Contains
- Does Not Contain
- Starts With
- Ends With
- Is Empty
- Is Not Empty

## 2. Long Text / Textarea

**Applicable Filters:**

- Is
- Is Not
- Contains
- Does Not Contain
- Starts With
- Ends With
- Is Empty
- Is Not Empty

## 3. Email

**Applicable Filters:**

- Is
- Is Not
- Contains
- Does Not Contain
- Starts With
- Ends With
- Is Empty
- Is Not Empty

## 4. Phone / Mobile Number

**Applicable Filters:**

- Is
- Is Not
- Contains
- Does Not Contain
- Starts With
- Ends With
- Is Empty
- Is Not Empty

> Treat Phone/Mobile fields as text values, not mathematical numbers.

## 5. Number

**Applicable Filters:**

- Equal To
- Not Equal To
- Greater Than
- Greater Than or Equal To
- Less Than
- Less Than or Equal To
- Between
- Is Empty
- Is Not Empty

## 6. Currency

**Applicable Filters:**

- Equal To
- Not Equal To
- Greater Than
- Greater Than or Equal To
- Less Than
- Less Than or Equal To
- Between
- Is Empty
- Is Not Empty

## 7. Percentage

**Applicable Filters:**

- Equal To
- Not Equal To
- Greater Than
- Greater Than or Equal To
- Less Than
- Less Than or Equal To
- Between
- Is Empty
- Is Not Empty

## 8. Date

**Applicable Filters:**

- Is
- Is Not
- Before
- After
- On or Before
- On or After
- Between
- Is Empty
- Is Not Empty

## 9. Date & Time / DateTime

**Applicable Filters:**

- Is
- Is Not
- Before
- After
- On or Before
- On or After
- Between
- Is Empty
- Is Not Empty

## 10. Dropdown / Select

**Applicable Filters:**

- Is
- Is Not
- Is Empty
- Is Not Empty

The filter value should be displayed as a dropdown containing the available options.

## 11. Multi-Select Dropdown

**Applicable Filters:**

- Contains Any
- Contains All
- Does Not Contain
- Is Empty
- Is Not Empty

The filter value should support selecting multiple options.

## 12. Checkbox / Boolean

**Applicable Filters:**

- Is True
- Is False

Alternatively, the UI can use:

`Is → Yes / No`

## 13. Radio Button

**Applicable Filters:**

- Is
- Is Not
- Is Empty
- Is Not Empty

The filter value should be displayed using the available radio options.

## 14. URL

**Applicable Filters:**

- Is
- Is Not
- Contains
- Does Not Contain
- Starts With
- Ends With
- Is Empty
- Is Not Empty

## 15. File / Attachment

**Applicable Filters:**

- Has File
- Has No File

For multiple attachments, also support:

- Contains File Type

---

# Important Requirements

1. Detect the field type before displaying filter operators.
2. Display **only valid operators** for that field type.
3. Dynamically change the value input based on the selected field type.
4. For Text fields, show a text input.
5. For Number/Currency/Percentage fields, show a numeric input.
6. For Date fields, show a date picker.
7. For DateTime fields, show a date-time picker.
8. For Dropdown fields, show the available dropdown options.
9. For Multi-Select fields, allow multiple selections.
10. For Boolean fields, show Yes/No.
11. For File fields, show file-existence related filters.
12. For `Between`, display two value inputs such as **From** and **To**.
13. For `Is Empty` and `Is Not Empty`, do not display a value input.
14. Do not show irrelevant operators for any field type.
15. Keep the filter configuration centralized so that adding a new field type or operator in the future is easy.
16. Preserve the existing UI/UX and styling conventions of the application.
17. Do not break any existing form, field, validation, or filtering functionality.
18. Ensure the implementation is reusable and maintainable rather than hardcoding filter logic separately in every component.

# Expected Result

Create a **complete and reusable field-type-based filtering system** where every input field automatically gets the correct set of filter operators and the correct value input control based on its field type.

The final implementation should cover **all input field types currently available in the application** and follow the mapping defined above.
