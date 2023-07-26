# Copyright 2023 Leonard Jung, Steffen Weiffenbach, Christopher Wolf, Dean Tomanelli

# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at

#     http://www.apache.org/licenses/LICENSE-2.0

# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


import mysql.connector
from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.sql.types import IntegerType, StringType, StructType, TimestampType

dbHost = "my-app-mariadb-service"
dbUser = "root"
dbPassword = "mysecretpw"
dbDatabase = "popular"

windowDuration = '1 minute'
slidingDuration = '1 minute'

# Create a spark session
spark = SparkSession.builder \
    .appName("Use Case").getOrCreate()

# Set log level
spark.sparkContext.setLogLevel('WARN')

# Read messages from Kafka
kafkaMessages = spark \
    .readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers",
            "my-cluster-kafka-bootstrap:9092") \
    .option("subscribe", "tracking-data") \
    .option("startingOffsets", "earliest") \
    .load()

# Define schema of tracking data
trackingMessageSchema = StructType() \
    .add("project", StringType()) \
    .add("timestamp", IntegerType())

# Convert value: binary -> JSON -> fields + parsed timestamp
trackingMessages = kafkaMessages.select(
    # Extract 'value' from Kafka message (i.e., the tracking data)
    from_json(
        column("value").cast("string"),
        trackingMessageSchema
    ).alias("json")
).select(
    # Convert Unix timestamp to TimestampType
    from_unixtime(column('json.timestamp'))
    .cast(TimestampType())
    .alias("parsed_timestamp"),

    # Select all JSON fields
    column("json.*")
) \
    .withColumnRenamed('json.project', 'project') \
    .withWatermark("parsed_timestamp", windowDuration)

# Compute most popular projects
popular = trackingMessages.groupBy(
    column("project")
).count()

# Start running the query; print running counts to the console
consoleDump = popular \
    .writeStream \
    .outputMode("update") \
    .format("console") \
    .start()

# Write counts to database

# We tried to implement this, but with the given code (using mysql-connector-java), we got:
#     java.sql.SQLException: Unknown system variable 'transaction_isolation'
# and using mariadb-java-client, we got:
#     ERROR ConnectionProvider: Failed to load built-in provider.

#dbUrl = 'jdbc:mariadb://my-app-mariadb-service:3306/popular'
#dbOptions = {"user": "root", "password": "mysecretpw"}
#dbSchema = 'popular'

#def saveToDatabase(batchDataframe, batchId):
    #global dbUrl, dbSchema, dbOptions
    #print(f"Writing batchID {batchId} to database @ {dbUrl}")
    #batchDataframe.distinct().write.jdbc(dbUrl, dbSchema, "overwrite", dbOptions)

# therefore, we decided insert the data "manually"
def saveToDatabase(batchDataframe, batchId):
    global dbHost, dbUser, dbPassword, dbDatabase
    print(f"Writing batchID {batchId} to database")
    mysql_conn = mysql.connector.connect(host=dbHost, user=dbUser, password=dbPassword, database=dbDatabase)
    mysql_cursor = mysql_conn.cursor()
    for row in batchDataframe.distinct().collect():
        print(row)
        mysql_cursor.execute("REPLACE INTO `popular` (`project`, `count`) VALUES (%s, %s)", (row["project"], row["count"]))
    mysql_conn.commit()
    mysql_cursor.close()
    mysql_conn.close()

dbInsertStream = popular \
    .select(column('project'), column('count')) \
    .writeStream \
    .outputMode("complete") \
    .foreachBatch(saveToDatabase) \
    .start()

# Wait for termination
spark.streams.awaitAnyTermination()
