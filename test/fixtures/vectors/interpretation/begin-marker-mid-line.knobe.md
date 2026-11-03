---
title: "Mid Line Marker"
spec_version: "1.0"
---

# Mid Line Marker

This sentence mentions -----BEGIN KNOBE B64----- mid-line and keeps going; a conforming verifier treats it as ordinary body text because payload markers must begin a line. The body hash sealed in the payload covers this entire body, including the mid-line marker text. Expected status: verified, body_verified: yes, conformance: valid.

-----BEGIN KNOBE B64-----
eyJhdHRyaWJ1dGlvbiI6eyJzb3VyY2VzIjpbeyJhdXRob3IiOiJEYXZpZCBLeWxlIiwiY29udHJp
YnV0aW9uIjoiVGVzdCB2ZWN0b3IgYXV0aG9yIn1dfSwiY29udGVudF90eXBlIjoib3JpZ2luYWwi
LCJjcmVhdGVkX2RhdGUiOiIyMDI2LTA3LTA4IiwibGljZW5zZSI6IkNDMCAxLjAiLCJwcml2YWN5
X2xldmVsIjoicHVibGljIiwicXVhcmFudGluZV9zdGF0dXMiOiJxdWFyYW50aW5lIiwic3BlY192
ZXJzaW9uIjoiMS4wIiwic3VtbWFyeSI6IlBpbnMgdGhhdCBwYXlsb2FkIG1hcmtlcnMgYXJlIGxp
bmUtYW5jaG9yZWQ6IG1hcmtlciB0ZXh0IG1pZC1saW5lIGlzIG9yZGluYXJ5IGJvZHkgY29udGVu
dC4iLCJ0aXRsZSI6Ik1pZCBMaW5lIE1hcmtlciIsImJvZHlfaGFzaCI6IjUzMDk4YTkzZTQ5ZjRj
ZjI1NDFjOWZhODU3Y2ZlNzMxMGJmMDVmOWMxNWY2NGRlY2FmM2IyNmM5NTk2NWQwZTEiLCJwYXls
b2FkX2hhc2giOiJiMmE0ZjA0ZmZiMWYyZTI1YTU2Zjg3OTg0OWM5MTYwOGMyNDJjZDc5YzBhZDcz
N2EyNDY1ZmEzNmQ4ZWRiZWU2In0=
-----END KNOBE B64-----
