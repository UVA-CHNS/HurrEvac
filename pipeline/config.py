"""Settings shared by the HEvOD pipeline and the static site export."""


WORKBOOK_NAME = "HEvOD_2014-2026_Website.xlsx"

TIMEZONES = [
    ("America/New_York", "Eastern (ET)"),
    ("America/Chicago", "Central (CT)"),
    ("America/Denver", "Mountain (MT)"),
    ("America/Los_Angeles", "Pacific (PT)"),
    ("America/Anchorage", "Alaska (AKT)"),
    ("America/Puerto_Rico", "Atlantic (AST)"),
    ("UTC", "UTC"),
]

# NHC graphics archive exceptions, e.g. {"Hurricane Hilary (2023)": "https://..."}
NHC_LINK_OVERRIDES = {}

BASEMAP_STYLES = {
    "light": "https://tiles.openfreemap.org/styles/positron",
    "dark": "https://tiles.openfreemap.org/styles/dark",
}

# How each Order Type is drawn (order = legend order). mode: "fill" or "outline".
ORDER_TYPE_STYLES = [
    {"name": "Mandatory evacuation order",  "mode": "fill",    "light": "#cb181d", "dark": "#fcbba1"},
    {"name": "Voluntary evacuation order",  "mode": "fill",    "light": "#fe9929", "dark": "#fee391"},
    {"name": "Evacuation order lifted",     "mode": "fill",    "light": "#addd8e", "dark": "#addd8e"},
    {"name": "Notice",                      "mode": "fill",    "light": "#9e9ac8", "dark": "#dadaeb"},
    {"name": "Emergency declared",          "mode": "outline", "light": "#2171b5", "dark": "#c6dbef"},
    {"name": "State of emergency lifted",   "mode": "outline", "light": "#006837", "dark": "#f7fcb9"},
]
OUTLINE_WIDTH = 2.5
