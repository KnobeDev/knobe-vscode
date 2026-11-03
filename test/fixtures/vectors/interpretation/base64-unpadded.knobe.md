---
title: "Unpadded Base64"
spec_version: "1.0"
---

# Unpadded Base64

The payload block below omits its trailing = padding characters. The specification references RFC 4648 section 4, standard Base64 with padding; a block that cannot be decoded under that encoding is unreadable. Expected status: unreadable, conformance: invalid.

-----BEGIN KNOBE B64-----
eyJhdHRyaWJ1dGlvbiI6eyJzb3VyY2VzIjpbeyJhdXRob3IiOiJEYXZpZCBLeWxlIiwiY29udHJp
YnV0aW9uIjoiVGVzdCB2ZWN0b3IgYXV0aG9yIn1dfSwiY29udGVudF90eXBlIjoib3JpZ2luYWwi
LCJjcmVhdGVkX2RhdGUiOiIyMDI2LTA3LTA4IiwibGljZW5zZSI6IkNDMCAxLjAiLCJwcml2YWN5
X2xldmVsIjoicHVibGljIiwicXVhcmFudGluZV9zdGF0dXMiOiJxdWFyYW50aW5lIiwic3BlY192
ZXJzaW9uIjoiMS4wIiwic3VtbWFyeSI6IlBpbnMgdGhhdCBSRkMgNDY0OCBzZWN0aW9uIDQgcGFk
ZGluZyBpcyByZXF1aXJlZDogYW4gdW5wYWRkZWQgcGF5bG9hZCBibG9jayBpcyB1bnJlYWRhYmxl
LiIsInRpdGxlIjoiVW5wYWRkZWQgQmFzZTY0IiwicHJvYmU6ZmlsbGVyIjoieHh4eHh4eHgiLCJw
YXlsb2FkX2hhc2giOiIyMGMxY2UxZmQ4YWY3OTAwYzIzYmZjZjExMmY4MmRhM2FhMmFlOWQzZTZm
OWRiOWYwZGUwMTQxYmRmZWMxMTUwIn0
-----END KNOBE B64-----
