/// Custom music-related event kinds for The Wired
///
/// - 31683: Music track metadata (addressable, title in tags)
/// - 33123: Album (addressable, title in tags)
/// - 30119: Playlist (addressable, title in tags)

/// Check if an event kind is a music-related kind
pub fn is_music_kind(kind: i32) -> bool {
    matches!(kind, 31683 | 33123 | 30119)
}

/// Validate music event structure by checking tags (not content).
/// Per ARCHITECTURE.md, title is stored in tags; content is optional.
pub fn validate_music_event(kind: i32, tags: &[Vec<String>]) -> bool {
    match kind {
        31683 => {
            // Track must have a "title" tag and a "d" tag
            let has_title = tags.iter().any(|t| t.len() >= 2 && t[0] == "title");
            let has_d = tags.iter().any(|t| t.len() >= 2 && t[0] == "d");
            has_title && has_d
        }
        33123 => {
            // Album must have a "title" tag and a "d" tag
            let has_title = tags.iter().any(|t| t.len() >= 2 && t[0] == "title");
            let has_d = tags.iter().any(|t| t.len() >= 2 && t[0] == "d");
            has_title && has_d
        }
        30119 => {
            // Playlist must have a "title" tag and a "d" tag
            let has_title = tags.iter().any(|t| t.len() >= 2 && t[0] == "title");
            let has_d = tags.iter().any(|t| t.len() >= 2 && t[0] == "d");
            has_title && has_d
        }
        _ => true,
    }
}
