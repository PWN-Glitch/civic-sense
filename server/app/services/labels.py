"""Six civic-issue categories + CLIP text prompts."""

CATEGORIES: tuple[str, ...] = (
    "pothole",
    "streetlight",
    "trash",
    "graffiti",
    "sidewalk damage",
    "other",
)

CLIP_PROMPTS: dict[str, str] = {
    "pothole": "a photo of a pothole in a road",
    "streetlight": "a photo of a broken or damaged streetlight",
    "trash": "a photo of overflowing trash or illegal dumping on a street",
    "graffiti": "a photo of graffiti or vandalism on a wall",
    "sidewalk damage": "a photo of a cracked or damaged sidewalk",
    "other": "a photo of a civic issue that does not fit the other categories",
}
