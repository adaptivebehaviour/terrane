All nodes inherit from a single ancestor `Node` with the following shape:
- id: same as existing id in node interfaces.  
- addedAt: same as existing addedAt in node interfaces.
- title: string | null
- description: string | null
- body: string | null

Remove `InformationNode` as this is now just `Node`.
Change the name of the existing `WorkspaceNode`to `FileNode`. Add an additional "path" property to `FileNode`.

The text in node displays defaults to the following in order of priority:  
- the title if title is not null 
- the description if title is null and description is not null  
- the first 127 characters of the body, including spaces, if both title and description are null.

Replace the existing functionality for the "Add" toolbar button with the following:
- a dialog appears when the user clicks on "Add"
- the dialog presents text-area entries for title (one line), description (two lines) and body (10 lines).
- a checkbox is presented next to each text entry label. The "Title" checkbox is ticked by default, while the other two are not. 
- ticked checkboxes indicate that the information should be presented in the node display, overriding the defaults listed above.  
If no information is entered into the text areas, the corresponding node property e.g. title, description etc is null.
- a "File" button is presented under the text entries. Clicking on this opens a file-picker dialog allowing the user to select a file. Display the path to the selected file. If a file is selected then this means that the node will be a `FileNode`.

Remove any objects or functionality that is no longer used as a result of these changes.