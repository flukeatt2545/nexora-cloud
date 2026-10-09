package main

import "testing"

func intPtr(v int) *int { return &v }

func TestReRootSharedFolderMakesSharedFolderTheTop(t *testing.T) {
	share := &publicSharedCategory{RootFolderID: intPtr(10), FolderIDs: []int{10, 11, 12}}
	folders := []publicSharedCategoryFolder{
		{ID: 10, ParentID: intPtr(1), Name: "shared"},
		{ID: 11, ParentID: intPtr(10), Name: "child"},
		{ID: 12, ParentID: intPtr(11), Name: "grandchild"},
	}
	files := []publicSharedCategoryFile{
		{ID: "a", FolderID: intPtr(10)},
		{ID: "b", FolderID: intPtr(11)},
		{ID: "c", FolderID: intPtr(12)},
	}

	gotFolders, gotFiles := reRootSharedFolder(share, folders, files)

	if len(gotFolders) != 2 {
		t.Fatalf("shared folder should be dropped from the list, got %d folders", len(gotFolders))
	}
	for _, fo := range gotFolders {
		if fo.ID == 10 {
			t.Fatal("shared folder still listed")
		}
		if fo.ID == 11 && fo.ParentID != nil {
			t.Fatalf("direct child should be top level, parent = %v", *fo.ParentID)
		}
		if fo.ID == 12 && (fo.ParentID == nil || *fo.ParentID != 11) {
			t.Fatal("grandchild should keep its parent")
		}
	}
	if gotFiles[0].FolderID != nil {
		t.Fatal("files in the shared folder should become loose files")
	}
	if gotFiles[1].FolderID == nil || *gotFiles[1].FolderID != 11 {
		t.Fatal("files in subfolders should keep their folder")
	}
}

func TestReRootSharedFolderKeepsLockedFolder(t *testing.T) {
	share := &publicSharedCategory{RootFolderID: intPtr(10), FolderIDs: []int{10, 11}, RootLocked: true}
	folders := []publicSharedCategoryFolder{
		{ID: 10, ParentID: intPtr(1), Name: "shared", PasswordRequired: true},
		{ID: 11, ParentID: intPtr(10), Name: "child"},
	}
	files := []publicSharedCategoryFile{{ID: "a", FolderID: intPtr(10)}}

	gotFolders, gotFiles := reRootSharedFolder(share, folders, files)

	if len(gotFolders) != 2 {
		t.Fatalf("a password-protected shared folder must stay so it can be unlocked, got %d", len(gotFolders))
	}
	if gotFolders[0].ParentID != nil {
		t.Fatal("shared folder should be top level (its parent is outside the share)")
	}
	if gotFolders[1].ParentID == nil || *gotFolders[1].ParentID != 10 {
		t.Fatal("child should stay under the locked shared folder")
	}
	if gotFiles[0].FolderID == nil || *gotFiles[0].FolderID != 10 {
		t.Fatal("files must stay behind the shared folder's password")
	}
}

func TestReRootSharedFolderLeavesCategorySharesAlone(t *testing.T) {
	folders := []publicSharedCategoryFolder{{ID: 11, ParentID: intPtr(10)}}
	files := []publicSharedCategoryFile{{ID: "a", FolderID: intPtr(10)}}
	gotFolders, gotFiles := reRootSharedFolder(&publicSharedCategory{}, folders, files)
	if gotFolders[0].ParentID == nil || gotFiles[0].FolderID == nil {
		t.Fatal("a category share must not be changed")
	}
}
