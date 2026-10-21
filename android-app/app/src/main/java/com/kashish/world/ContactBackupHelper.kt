package com.kashish.world

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.os.Build
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

object ContactBackupHelper {

    fun hasContactsPermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_CONTACTS
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun getContactsCount(context: Context): Int {
        if (!hasContactsPermission(context)) return 0
        var cursor: Cursor? = null
        return try {
            cursor = context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.CommonDataKinds.Phone.CONTACT_ID),
                null,
                null,
                null
            )
            cursor?.count ?: 0
        } catch (_: Exception) {
            0
        } finally {
            cursor?.close()
        }
    }

    /**
     * Reads all device phone contacts, associates emails, normalizes phone numbers,
     * and returns a JSON Array string containing all contact records.
     */
    fun getDeviceContactsJson(context: Context): String {
        if (!hasContactsPermission(context)) {
            return "[]"
        }

        val jsonArray = JSONArray()
        val deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

        // 1. Map contactId -> List of Emails
        val emailMap = mutableMapOf<String, MutableList<String>>()
        var emailCursor: Cursor? = null
        try {
            emailCursor = context.contentResolver.query(
                ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Email.CONTACT_ID,
                    ContactsContract.CommonDataKinds.Email.ADDRESS
                ),
                null,
                null,
                null
            )
            emailCursor?.let { cursor ->
                val idIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.CONTACT_ID)
                val emailIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.ADDRESS)
                while (cursor.moveToNext()) {
                    if (idIdx != -1 && emailIdx != -1) {
                        val contactId = cursor.getString(idIdx) ?: ""
                        val email = cursor.getString(emailIdx)?.trim() ?: ""
                        if (contactId.isNotEmpty() && email.isNotEmpty()) {
                            emailMap.getOrPut(contactId) { mutableListOf() }.add(email)
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // Ignore optional email read errors
        } finally {
            emailCursor?.close()
        }

        // 2. Query phone numbers & names
        var phoneCursor: Cursor? = null
        val seenPhoneNumbers = mutableSetOf<String>()

        try {
            phoneCursor = context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER,
                    ContactsContract.CommonDataKinds.Phone.STARRED
                ),
                null,
                null,
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
            )

            phoneCursor?.let { cursor ->
                val contactIdIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
                val nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numberIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                val starredIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.STARRED)

                while (cursor.moveToNext()) {
                    val rawNumber = if (numberIdx != -1) cursor.getString(numberIdx) ?: "" else ""
                    val cleanNumber = rawNumber.replace("[^0-9+]".toRegex(), "").trim()
                    if (cleanNumber.isEmpty()) continue

                    // Deduplicate by clean number
                    val dedupKey = cleanNumber.replace("+", "")
                    if (seenPhoneNumbers.contains(dedupKey)) continue
                    seenPhoneNumbers.add(dedupKey)

                    val contactId = if (contactIdIdx != -1) cursor.getString(contactIdIdx) ?: "" else ""
                    val displayName = if (nameIdx != -1) cursor.getString(nameIdx) ?: "Unnamed Contact" else "Unnamed Contact"
                    val isStarred = if (starredIdx != -1) cursor.getInt(starredIdx) == 1 else false

                    val contactObj = JSONObject()
                    contactObj.put("id", "c_$dedupKey")
                    contactObj.put("contactId", contactId)
                    contactObj.put("name", displayName.ifBlank { "Unnamed Contact" })
                    contactObj.put("phoneNumber", rawNumber.trim())
                    contactObj.put("cleanNumber", cleanNumber)
                    contactObj.put("starred", isStarred)
                    contactObj.put("deviceModel", deviceModel)
                    contactObj.put("syncedAt", System.currentTimeMillis())

                    val emails = emailMap[contactId]
                    val emailsArray = JSONArray()
                    emails?.forEach { emailsArray.put(it) }
                    contactObj.put("emails", emailsArray)

                    jsonArray.put(contactObj)
                }
            }
        } catch (_: Exception) {
            // Return whatever was collected
        } finally {
            phoneCursor?.close()
        }

        return jsonArray.toString()
    }
}
