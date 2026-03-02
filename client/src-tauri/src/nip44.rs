use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chacha20::cipher::{KeyIvInit, StreamCipher};
use chacha20::ChaCha20;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::RngCore;
use secp256k1::{PublicKey, SecretKey};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const NIP44_SALT: &[u8] = b"nip44-v2";
const VERSION: u8 = 2;
const MIN_PLAINTEXT_SIZE: usize = 1;
const MAX_PLAINTEXT_SIZE: usize = 65535;

/// Convert a 32-byte x-only Nostr pubkey (hex) to a full secp256k1 PublicKey.
/// Prepends 0x02 (even y-coordinate) per BIP-340 convention.
pub fn xonly_to_pubkey(hex_pubkey: &str) -> Result<PublicKey, String> {
    let x_bytes = hex::decode(hex_pubkey).map_err(|e| format!("Invalid pubkey hex: {e}"))?;
    if x_bytes.len() != 32 {
        return Err("Pubkey must be 32 bytes".to_string());
    }
    let mut full = Vec::with_capacity(33);
    full.push(0x02);
    full.extend_from_slice(&x_bytes);
    PublicKey::from_slice(&full).map_err(|e| format!("Invalid public key: {e}"))
}

/// Compute the NIP-44 conversation key via ECDH + HKDF-Extract.
///
/// 1. ECDH: multiply pub_b by secret_a → shared point
/// 2. Take the x-coordinate (first 32 bytes) of the shared point (unhashed, per NIP-44 spec)
/// 3. HKDF-Extract with salt="nip44-v2" and IKM=shared_x → conversation_key (PRK)
pub fn get_conversation_key(secret_key: &SecretKey, public_key: &PublicKey) -> Result<[u8; 32], String> {
    // shared_secret_point returns the full 64-byte uncompressed point (x || y), unhashed
    let shared_point = secp256k1::ecdh::shared_secret_point(public_key, secret_key);
    let shared_x = &shared_point[..32];

    let (prk, _) = Hkdf::<Sha256>::extract(Some(NIP44_SALT), shared_x);
    let mut conversation_key = [0u8; 32];
    conversation_key.copy_from_slice(&prk);
    Ok(conversation_key)
}

/// Derive per-message keys from conversation_key and nonce via HKDF-Expand.
/// Returns (chacha_key[32], chacha_nonce[12], hmac_key[32]).
pub fn get_message_keys(conversation_key: &[u8; 32], nonce: &[u8; 32]) -> Result<([u8; 32], [u8; 12], [u8; 32]), String> {
    let hkdf = Hkdf::<Sha256>::from_prk(conversation_key)
        .map_err(|e| format!("Invalid PRK: {e}"))?;
    let mut okm = [0u8; 76];
    hkdf.expand(nonce, &mut okm)
        .map_err(|e| format!("HKDF expand failed: {e}"))?;

    let mut chacha_key = [0u8; 32];
    let mut chacha_nonce = [0u8; 12];
    let mut hmac_key = [0u8; 32];

    chacha_key.copy_from_slice(&okm[0..32]);
    chacha_nonce.copy_from_slice(&okm[32..44]);
    hmac_key.copy_from_slice(&okm[44..76]);

    Ok((chacha_key, chacha_nonce, hmac_key))
}

/// Calculate padded length using NIP-44's power-of-two chunking scheme.
pub fn calc_padded_len(unpadded_len: usize) -> Result<usize, String> {
    if unpadded_len < MIN_PLAINTEXT_SIZE {
        return Err("Plaintext too short".to_string());
    }
    if unpadded_len > MAX_PLAINTEXT_SIZE {
        return Err("Plaintext too long".to_string());
    }
    if unpadded_len <= 32 {
        return Ok(32);
    }
    // next_power = 1 << (floor(log2(unpadded_len - 1)) + 1)
    let next_power = (unpadded_len - 1).next_power_of_two();
    let chunk = if next_power <= 256 { 32 } else { next_power / 8 };
    Ok(chunk * (((unpadded_len - 1) / chunk) + 1))
}

/// Pad plaintext per NIP-44: [u16_be_length][plaintext][zero_padding]
pub fn pad(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let unpadded_len = plaintext.len();
    if unpadded_len < MIN_PLAINTEXT_SIZE || unpadded_len > MAX_PLAINTEXT_SIZE {
        return Err(format!("Invalid plaintext length: {unpadded_len}"));
    }
    let padded_len = calc_padded_len(unpadded_len)?;
    let mut result = Vec::with_capacity(2 + padded_len);
    result.extend_from_slice(&(unpadded_len as u16).to_be_bytes());
    result.extend_from_slice(plaintext);
    result.resize(2 + padded_len, 0);
    Ok(result)
}

/// Unpad a padded byte array back to the original plaintext.
pub fn unpad(padded: &[u8]) -> Result<Vec<u8>, String> {
    if padded.len() < 2 + MIN_PLAINTEXT_SIZE {
        return Err("Padded data too short".to_string());
    }
    let unpadded_len = u16::from_be_bytes([padded[0], padded[1]]) as usize;
    if unpadded_len == 0 || unpadded_len > MAX_PLAINTEXT_SIZE {
        return Err("Invalid unpadded length".to_string());
    }
    if 2 + unpadded_len > padded.len() {
        return Err("Plaintext length exceeds padded data".to_string());
    }
    let expected_padded_len = calc_padded_len(unpadded_len)?;
    if padded.len() != 2 + expected_padded_len {
        return Err("Invalid padding".to_string());
    }
    // Verify trailing zeros
    for &b in &padded[2 + unpadded_len..] {
        if b != 0 {
            return Err("Non-zero padding bytes".to_string());
        }
    }
    Ok(padded[2..2 + unpadded_len].to_vec())
}

/// HMAC-SHA256 with AAD (nonce is prepended to message as additional authenticated data).
fn hmac_aad(key: &[u8; 32], message: &[u8], aad: &[u8; 32]) -> Result<[u8; 32], String> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|e| format!("HMAC init failed: {e}"))?;
    mac.update(aad);
    mac.update(message);
    let result = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    Ok(out)
}

/// Encrypt plaintext using NIP-44 v2.
/// conversation_key: the shared key from get_conversation_key.
/// Returns base64-encoded payload: version(1) || nonce(32) || ciphertext || mac(32).
pub fn encrypt(plaintext: &str, conversation_key: &[u8; 32]) -> Result<String, String> {
    let plaintext_bytes = plaintext.as_bytes();
    if plaintext_bytes.len() < MIN_PLAINTEXT_SIZE || plaintext_bytes.len() > MAX_PLAINTEXT_SIZE {
        return Err(format!("Invalid plaintext length: {}", plaintext_bytes.len()));
    }

    // Generate random 32-byte nonce
    let mut nonce = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut nonce);

    encrypt_with_nonce(plaintext, conversation_key, &nonce)
}

/// Encrypt with a specific nonce (used for testing with known test vectors).
fn encrypt_with_nonce(plaintext: &str, conversation_key: &[u8; 32], nonce: &[u8; 32]) -> Result<String, String> {
    let plaintext_bytes = plaintext.as_bytes();

    let (chacha_key, chacha_nonce, hmac_key) = get_message_keys(conversation_key, nonce)?;

    // Pad
    let padded = pad(plaintext_bytes)?;

    // Encrypt with ChaCha20
    let mut ciphertext = padded;
    let mut cipher = ChaCha20::new(
        chacha_key.as_ref().into(),
        chacha_nonce.as_ref().into(),
    );
    cipher.apply_keystream(&mut ciphertext);

    // Compute HMAC with AAD (nonce)
    let mac = hmac_aad(&hmac_key, &ciphertext, nonce)?;

    // Assemble: version || nonce || ciphertext || mac
    let mut payload = Vec::with_capacity(1 + 32 + ciphertext.len() + 32);
    payload.push(VERSION);
    payload.extend_from_slice(nonce);
    payload.extend_from_slice(&ciphertext);
    payload.extend_from_slice(&mac);

    Ok(BASE64.encode(&payload))
}

/// Decrypt a NIP-44 v2 payload.
/// conversation_key: the shared key from get_conversation_key.
/// payload: base64-encoded string.
pub fn decrypt(payload: &str, conversation_key: &[u8; 32]) -> Result<String, String> {
    // Validate payload length (base64: 132 to 87472)
    let plen = payload.len();
    if plen == 0 || payload.starts_with('#') {
        return Err("Unknown encryption version".to_string());
    }
    if plen < 132 || plen > 87472 {
        return Err(format!("Invalid payload size: {plen}"));
    }

    // Decode base64
    let data = BASE64.decode(payload).map_err(|e| format!("Base64 decode failed: {e}"))?;
    let dlen = data.len();

    // Validate decoded length (99 to 65603)
    if dlen < 99 || dlen > 65603 {
        return Err(format!("Invalid data size: {dlen}"));
    }

    // Check version
    if data[0] != VERSION {
        return Err(format!("Unknown version: {}", data[0]));
    }

    // Parse components
    let mut nonce = [0u8; 32];
    nonce.copy_from_slice(&data[1..33]);
    let ciphertext = &data[33..dlen - 32];
    let mut mac = [0u8; 32];
    mac.copy_from_slice(&data[dlen - 32..dlen]);

    // Derive message keys
    let (chacha_key, chacha_nonce, hmac_key) = get_message_keys(conversation_key, &nonce)?;

    // Verify MAC BEFORE decryption (constant-time comparison via hmac crate)
    let mut verifier = HmacSha256::new_from_slice(&hmac_key)
        .map_err(|e| format!("HMAC init failed: {e}"))?;
    verifier.update(&nonce);
    verifier.update(ciphertext);
    verifier.verify_slice(&mac)
        .map_err(|_| "Invalid MAC".to_string())?;

    // Decrypt with ChaCha20
    let mut plaintext_padded = ciphertext.to_vec();
    let mut cipher = ChaCha20::new(
        chacha_key.as_ref().into(),
        chacha_nonce.as_ref().into(),
    );
    cipher.apply_keystream(&mut plaintext_padded);

    // Unpad
    let plaintext_bytes = unpad(&plaintext_padded)?;
    String::from_utf8(plaintext_bytes).map_err(|e| format!("Invalid UTF-8: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calc_padded_len() {
        // Min: 1 byte → 32
        assert_eq!(calc_padded_len(1).unwrap(), 32);
        // 32 bytes → 32
        assert_eq!(calc_padded_len(32).unwrap(), 32);
        // 33 bytes → 64
        assert_eq!(calc_padded_len(33).unwrap(), 64);
        // 64 bytes → 64
        assert_eq!(calc_padded_len(64).unwrap(), 64);
        // 65 bytes → 96
        assert_eq!(calc_padded_len(65).unwrap(), 96);
        // Max: 65535 → 65536
        assert_eq!(calc_padded_len(65535).unwrap(), 65536);
    }

    #[test]
    fn test_pad_unpad_roundtrip() {
        let cases = vec!["a", "hello", "hello world this is a test message"];
        for msg in cases {
            let padded = pad(msg.as_bytes()).unwrap();
            let unpadded = unpad(&padded).unwrap();
            assert_eq!(unpadded, msg.as_bytes());
        }
    }

    #[test]
    fn test_conversation_key_from_test_vector() {
        // NIP-44 test vector: sec1=0x01, sec2=0x02
        let sec1_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000001").unwrap();
        let sec1 = SecretKey::from_slice(&sec1_bytes).unwrap();

        let sec2_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000002").unwrap();
        let sec2 = SecretKey::from_slice(&sec2_bytes).unwrap();

        // Derive pub2 from sec2
        let secp = secp256k1::Secp256k1::new();
        let pub2 = sec2.public_key(&secp);

        let conv_key = get_conversation_key(&sec1, &pub2).unwrap();
        assert_eq!(
            hex::encode(conv_key),
            "c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d"
        );

        // Verify symmetry: conv(sec2, pub1) == conv(sec1, pub2)
        let pub1 = sec1.public_key(&secp);
        let conv_key2 = get_conversation_key(&sec2, &pub1).unwrap();
        assert_eq!(conv_key, conv_key2);
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let sec1_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000001").unwrap();
        let sec1 = SecretKey::from_slice(&sec1_bytes).unwrap();

        let sec2_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000002").unwrap();
        let sec2 = SecretKey::from_slice(&sec2_bytes).unwrap();

        let secp = secp256k1::Secp256k1::new();
        let pub2 = sec2.public_key(&secp);
        let pub1 = sec1.public_key(&secp);

        let conv_key_sender = get_conversation_key(&sec1, &pub2).unwrap();
        let conv_key_recipient = get_conversation_key(&sec2, &pub1).unwrap();
        assert_eq!(conv_key_sender, conv_key_recipient);

        let plaintext = "hello world";
        let encrypted = encrypt(plaintext, &conv_key_sender).unwrap();
        let decrypted = decrypt(&encrypted, &conv_key_recipient).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_known_payload_decryption() {
        // NIP-44 test vector
        let sec1_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000001").unwrap();
        let sec1 = SecretKey::from_slice(&sec1_bytes).unwrap();

        let sec2_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000002").unwrap();
        let sec2 = SecretKey::from_slice(&sec2_bytes).unwrap();

        let secp = secp256k1::Secp256k1::new();
        let pub2 = sec2.public_key(&secp);

        let conv_key = get_conversation_key(&sec1, &pub2).unwrap();

        // Test vector payload
        let payload = "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb";
        let decrypted = decrypt(payload, &conv_key).unwrap();
        assert_eq!(decrypted, "a");
    }

    #[test]
    fn test_encrypt_with_known_nonce() {
        // Verify encryption produces the exact test vector payload
        let sec1_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000001").unwrap();
        let sec1 = SecretKey::from_slice(&sec1_bytes).unwrap();

        let sec2_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000002").unwrap();
        let sec2 = SecretKey::from_slice(&sec2_bytes).unwrap();

        let secp = secp256k1::Secp256k1::new();
        let pub2 = sec2.public_key(&secp);

        let conv_key = get_conversation_key(&sec1, &pub2).unwrap();

        let nonce_hex = "0000000000000000000000000000000000000000000000000000000000000001";
        let mut nonce = [0u8; 32];
        nonce.copy_from_slice(&hex::decode(nonce_hex).unwrap());

        let encrypted = encrypt_with_nonce("a", &conv_key, &nonce).unwrap();
        assert_eq!(
            encrypted,
            "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb"
        );
    }

    #[test]
    fn test_xonly_to_pubkey() {
        // Derive a known pubkey from sec2=0x02
        let sec2_bytes = hex::decode("0000000000000000000000000000000000000000000000000000000000000002").unwrap();
        let sec2 = SecretKey::from_slice(&sec2_bytes).unwrap();
        let secp = secp256k1::Secp256k1::new();
        let (xonly, _) = sec2.x_only_public_key(&secp);
        let xonly_hex = hex::encode(xonly.serialize());

        let recovered = xonly_to_pubkey(&xonly_hex).unwrap();
        // The recovered full pubkey should be valid
        assert_eq!(recovered.serialize().len(), 33);
    }
}
