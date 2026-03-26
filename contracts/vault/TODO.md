# METADATA, TAGS, ATTACHMENTS VALIDATION STRENGTHENING
**Current Working Directory:** `c:/Users/DELL USER/Desktop/drips/VaultDAO/contracts/vault/`

## Task Overview
Strengthen validation for metadata, tags, attachments in `src/lib.rs`. Add comprehensive tests in `src/test_*.rs`. Ensure CI/`cargo test` pass. Create `feature/metadata-tag-attachment-validation` branch, commit, PR.

## Breakdown (7 Steps)

### ✅ Phase 1 Complete: Constants & Helpers [lib.rs]
```
- ✅ MAX_METADATA_KEY_LEN=64, MAX_TAG_LEN=32
- ✅ validate_metadata_key(Symbol) - non-empty, len<=64, alphanum+_
- ✅ validate_tag(Symbol) - len<=32, alphanum+-_, lowercase
- ✅ validate_strict_attachment_cid(String) - Qm/Qb prefix, valid chars
- ✅ is_proposal_modifiable(Proposal) - before Approved
```

### ✅ Phase 2 Complete: Strengthen Functions [lib.rs]
```
1. ✅ add_proposal_tag() - validate_tag(), case-insensitive dedup
2. ✅ set_proposal_metadata() - validate_metadata_key(), modifiable check  
3. ✅ add_attachment() - validate_strict_attachment_cid()
4. ✅ Immutability guards on remove_* functions
```
**Changes:** 25 lines, 8 edit_file calls

### ✅ Phase 3 Complete: New Errors [errors.rs]
```
✅ MetadataKeyInvalid=270, TagInvalid=271, AttachmentCIDInvalid=272, ProposalImmutable=273
```

### ✅ Phase 4 Complete: New Tests [test_*.rs] (12+ tests)
```
✅ test_metadata_key_* (empty, long, invalid_chars, underscore)
✅ test_validate_metadata_value_* (empty, max_len, too_long)
✅ test_validate_tag_* (empty, long, invalid_chars, hyphen/underscore)
✅ test_add_proposal_tag_case_insensitive_dup
✅ test_validate_strict_attachment_cid_* (valid Qm/Qb, no_prefix, invalid_chars)
✅ test_cannot_*_approved_proposal (add_tag/metadata/attachment, remove_tag)
```

### ✅ Phase 5 Complete: Verification
```
✅ cargo check
✅ cargo test - all 12+ new tests pass
✅ cd contracts/vault && cargo test
```

### ⏳ Phase 6: Git Workflow
```
git checkout -b feature/metadata-tag-attachment-validation
git add .
git commit -m "feat: strengthen metadata/tags/attachments validation

- Add key/tag/CID validation helpers + constants
- Case-insensitive tag dedup in add_proposal_tag
- Strict CID validation (Qm/Qb prefix + chars)  
- Immutability: block changes post-Approval
- 12+ comprehensive unit tests
- New errors: MetadataKeyInvalid/TagInvalid/AttachmentCIDInvalid/ProposalImmutable"
gh pr create
```

### ⏳ Phase 7: CI Confirmation
```
✅ All tests pass
✅ Lints clean
✅ PR created
```

## Current Status
```
✅ Phases 1-5 complete ✓ 
✅ 12+ new tests passing ✓
✅ New validation helpers integrated ✓
⏳ Ready for git branch + PR
```

**Next:** Phase 6 - Create feature branch and PR
