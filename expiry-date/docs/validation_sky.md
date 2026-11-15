# Sky validation against JPL Horizons

Our value = `core.js` with `sky_2027_2066.bin` (Horizons sub-Earth/sub-solar points, hourly, linear interpolation, Sun at infinity, Earth at finite distance).
Reference = Horizons observer table, apparent azimuth/elevation of the body centre seen from a user-defined site on the Moon (retrieved 2026-11-14).
Target: angular separation < 0.1 deg. Aberration (up to 0.006 deg) and the Sun's parallax from the Moon's radius (0.0007 deg) are not modelled.

| Site | Body | Date (UTC) | Az ours | Az Horizons | El ours | El Horizons | dAz | dEl | Separation |
|---|---|---|---|---|---|---|---|---|---|
| south pole | sun | 2027-03-12 04:00 | 9.2925 | 9.2923 | -0.2897 | -0.2904 | 0.0002 | 0.0007 | 0.0007 |
| south pole | sun | 2041-09-27 16:59 | 29.6849 | 29.6847 | -0.4322 | -0.4329 | 0.0002 | 0.0007 | 0.0007 |
| south pole | sun | 2063-06-05 22:00 | 306.9648 | 306.9646 | -1.2250 | -1.2256 | 0.0002 | 0.0007 | 0.0007 |
| south pole | earth | 2027-03-12 04:00 | 234.5011 | 234.4969 | 6.0002 | 6.0005 | 0.0042 | -0.0003 | 0.0042 |
| south pole | earth | 2041-09-27 16:59 | 235.6676 | 235.6622 | 0.1804 | 0.1805 | 0.0053 | -0.0001 | 0.0053 |
| south pole | earth | 2063-06-05 22:00 | 243.7715 | 243.7739 | -4.1722 | -4.1726 | -0.0024 | 0.0003 | 0.0024 |
| mid latitude | sun | 2027-03-12 04:00 | 347.1423 | 347.1426 | -43.4795 | -43.4801 | -0.0002 | 0.0005 | 0.0005 |
| mid latitude | sun | 2041-09-27 16:59 | 321.6048 | 321.6050 | -37.1228 | -37.1234 | -0.0002 | 0.0006 | 0.0006 |
| mid latitude | sun | 2063-06-05 22:00 | 60.9459 | 60.9461 | -23.9619 | -23.9624 | -0.0001 | 0.0005 | 0.0005 |
| mid latitude | earth | 2027-03-12 04:00 | 121.0971 | 121.1008 | 18.8289 | 18.8311 | -0.0037 | -0.0023 | 0.0042 |
| mid latitude | earth | 2041-09-27 16:59 | 116.2663 | 116.2709 | 22.7219 | 22.7251 | -0.0046 | -0.0033 | 0.0053 |
| mid latitude | earth | 2063-06-05 22:00 | 106.5956 | 106.5936 | 20.7081 | 20.7067 | 0.0021 | 0.0014 | 0.0024 |
| equator (Apollo 11 LM) | sun | 2027-03-12 04:00 | 88.9951 | 88.9951 | -15.8079 | -15.8083 | -0.0000 | 0.0005 | 0.0005 |
| equator (Apollo 11 LM) | sun | 2041-09-27 16:59 | 88.4326 | 88.4326 | -36.1942 | -36.1946 | -0.0000 | 0.0004 | 0.0004 |
| equator (Apollo 11 LM) | sun | 2063-06-05 22:00 | 88.4938 | 88.4938 | 46.5184 | 46.5182 | 0.0000 | 0.0003 | 0.0003 |
| equator (Apollo 11 LM) | earth | 2027-03-12 04:00 | 255.4984 | 255.4996 | 60.1118 | 60.1077 | -0.0012 | 0.0042 | 0.0042 |
| equator (Apollo 11 LM) | earth | 2041-09-27 16:59 | 267.1986 | 267.1988 | 62.0480 | 62.0426 | -0.0002 | 0.0054 | 0.0054 |
| equator (Apollo 11 LM) | earth | 2063-06-05 22:00 | 278.9801 | 278.9819 | 69.9657 | 69.9680 | -0.0019 | -0.0023 | 0.0024 |

**Worst separation: 0.0054 deg** over 18 comparisons (target met).
